class SearchEngine {
  constructor() {
    this.searchInput = document.getElementById('searchInput');
    this.searchButton = document.getElementById('searchButton');
    this.resultsContainer = document.getElementById('resultsContainer');
    this.currentPage = 1;
    this.resultsPerPage = 10;
    this.totalResults = 0;
    this.currentResults = [];
    this.isLoading = false;
    this.seenDomains = new Set();
    this.cache = new Map();
    this.abortController = null;
    
    this.setupEventListeners();
    this.initializeTheme();
  }

  initializeTheme() {
    const darkMode = localStorage.getItem('darkMode') === 'true';
    if (darkMode) {
      document.body.classList.add('dark-mode');
    }
    
    const themeToggle = document.createElement('button');
    themeToggle.className = 'theme-toggle';
    themeToggle.innerHTML = `
      <svg viewBox="0 0 24 24">
        <path d="M12,18C11.11,18 10.26,17.8 9.5,17.45C11.56,16.5 13,14.42 13,12C13,9.58 11.56,7.5 9.5,6.55C10.26,6.2 11.11,6 12,6A6,6 0 0,1 18,12A6,6 0 0,1 12,18M20,8.69V4H15.31L12,0.69L8.69,4H4V8.69L0.69,12L4,15.31V20H8.69L12,23.31L15.31,20H20V15.31L23.31,12L20,8.69Z"/>
      </svg>
    `;
    themeToggle.addEventListener('click', () => this.toggleTheme());
    document.body.appendChild(themeToggle);
  }

  toggleTheme() {
    const isDarkMode = document.body.classList.toggle('dark-mode');
    localStorage.setItem('darkMode', isDarkMode);
  }

  setupEventListeners() {
    this.searchButton.addEventListener('click', () => this.performSearch());
    this.searchInput.addEventListener('keypress', (e) => {
      if (e.key === 'Enter') {
        this.performSearch();
      }
    });
  }

  async performSearch(page = 1) {
    const query = this.searchInput.value.trim();
    if (!query) return;

    // Easter egg for "69" but keeping both blue dots
    if (query === "69") {
      document.querySelector('h1').classList.add('funny-title');
      document.querySelector('h1').innerHTML = 'Funny<span class="accent">.</span>';
      document.querySelector('.tagline').classList.add('funny-tagline');
    } else {
      document.querySelector('h1').classList.remove('funny-title');
      document.querySelector('h1').innerHTML = 'This<span class="accent">.</span>';
      document.querySelector('.tagline').classList.remove('funny-tagline');
    }

    if (this.abortController) {
      this.abortController.abort();
    }
    this.abortController = new AbortController();

    this.currentPage = page;
    this.resultsContainer.innerHTML = '<div class="loading-spinner"></div>';
    this.isLoading = true;

    try {
      const cacheKey = `${query}-${page}`;
      if (this.cache.has(cacheKey)) {
        this.currentResults = this.cache.get(cacheKey);
        this.totalResults = this.currentResults.length;
        this.displayResults();
        return;
      }

      const results = await this.fetchWebResultsOptimized(query);

      this.cache.set(cacheKey, results);
      
      if (this.cache.size > 20) {
        const firstKey = this.cache.keys().next().value;
        this.cache.delete(firstKey);
      }

      this.currentResults = results;
      this.totalResults = results.length;
      this.displayResults();
    } catch (error) {
      if (error.name === 'AbortError') return;
      this.resultsContainer.innerHTML = '<p class="error">An error occurred while searching. Please try again.</p>';
    } finally {
      this.isLoading = false;
    }
  }

  async fetchWebResultsOptimized(query) {
    const timeout = ms => new Promise((_, reject) => 
      setTimeout(() => reject(new Error('timeout')), ms));

    const fetchWithTimeout = async (promise, ms) => {
      try {
        return await Promise.race([promise, timeout(ms)]);
      } catch (e) {
        return [];
      }
    };

    // Reduced timeout to 1500ms for faster responses
    const results = await Promise.all([
      this.fetchDomainMatch(query),
      fetchWithTimeout(this.fetchFromWikipedia(query), 1500),
      fetchWithTimeout(this.fetchFromGithub(query), 1500),
      fetchWithTimeout(this.fetchFromStackExchange(query), 1500),
      fetchWithTimeout(this.fetchFromHackerNews(query), 1500),
      fetchWithTimeout(this.fetchFromLibrary(query), 1500)
    ]);

    // Process results in parallel
    const processedResults = await Promise.all(
      results.flat()
        .filter(Boolean)
        .map(async result => ({
          ...result,
          description: result.description || 'This website has no description.'
        }))
    );

    // Rank and limit results
    return this.limitResultsPerDomain(
      this.rankResults(query, processedResults)
    );
  }

  async fetchDomainMatch(query) {
    const cleanQuery = query.toLowerCase()
      .replace(/[^a-z0-9]/g, '')
      .replace(/\s+/g, '');
    
    const tlds = ['com', 'net', 'org', 'io', 'app', 'dev', 'games'];
    
    const results = await Promise.all(tlds.map(async tld => {
      const domain = `${cleanQuery}.${tld}`;
      try {
        const response = await fetch(`https://${domain}`, {
          method: 'HEAD',
          mode: 'no-cors',
          signal: this.abortController.signal,
          timeout: 1000 // Reduce timeout to 1 second
        });
        
        return {
          title: `${cleanQuery}.${tld}`,
          url: `https://${domain}`,
          description: `This website has no description`,
          domain: domain,
          relevance: 100
        };
      } catch (e) {
        return null;
      }
    }));

    return results.filter(Boolean);
  }

  async fetchFromWikipedia(query) {
    const response = await fetch(
      `https://en.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(query)}&format=json&origin=*`
    );
    
    if (!response.ok) return [];
    
    const data = await response.json();
    return data.query.search.map(result => ({
      title: result.title,
      url: `https://en.wikipedia.org/wiki/${encodeURIComponent(result.title)}`,
      description: this.stripHtml(result.snippet),
      domain: 'wikipedia.org',
      relevance: 70
    }));
  }

  async fetchFromGithub(query) {
    const response = await fetch(
      `https://api.github.com/search/repositories?q=${encodeURIComponent(query)}&sort=stars`
    );
    
    if (!response.ok) return [];
    
    const data = await response.json();
    return data.items.map(item => ({
      title: item.full_name,
      url: item.html_url,
      description: item.description || 'No description available',
      domain: 'github.com',
      relevance: 60
    }));
  }

  async fetchFromStackExchange(query) {
    const response = await fetch(
      `https://api.stackexchange.com/2.3/search/advanced?q=${encodeURIComponent(query)}&site=stackoverflow&pagesize=10`
    );
    
    if (!response.ok) return [];
    
    const data = await response.json();
    return data.items.map(item => ({
      title: item.title,
      url: item.link,
      description: this.stripHtml(item.body_markdown || item.title),
      domain: 'stackoverflow.com',
      relevance: 50
    }));
  }

  async fetchFromHackerNews(query) {
    const response = await fetch(
      `https://hn.algolia.com/api/v1/search?query=${encodeURIComponent(query)}&tags=story`
    );
    
    if (!response.ok) return [];
    
    const data = await response.json();
    return data.hits.map(item => ({
      title: item.title,
      url: item.url || `https://news.ycombinator.com/item?id=${item.objectID}`,
      description: item.story_text || item.title,
      domain: new URL(item.url || `https://news.ycombinator.com`).hostname,
      relevance: 30
    }));
  }

  async fetchFromLibrary(query) {
    const response = await fetch(
      `https://openlibrary.org/search.json?q=${encodeURIComponent(query)}`
    );
    if (!response.ok) return [];
    
    const data = await response.json();
    return data.docs.map(book => ({
      title: book.title,
      url: `https://openlibrary.org${book.key}`,
      description: `${book.author_name ? 'By ' + book.author_name.join(', ') : ''} - ${book.first_publish_year || ''}`,
      domain: 'openlibrary.org',
      relevance: 10
    }));
  }

  limitResultsPerDomain(results) {
    const domainCounts = new Map();
    this.seenDomains.clear();
    
    return results.filter(result => {
      const domain = this.extractDomain(result.url);
      const count = domainCounts.get(domain) || 0;
      
      const searchTerms = this.searchInput.value.toLowerCase().split(/\s+/);
      const isDomainMatch = searchTerms.some(term => 
        domain.toLowerCase().includes(term) || 
        term.includes(domain.toLowerCase())
      );
      const maxResults = isDomainMatch ? 50 : 1;
      
      if (count >= maxResults) return false;
      
      domainCounts.set(domain, count + 1);
      this.seenDomains.add(domain);
      return true;
    });
  }

  extractDomain(url) {
    try {
      return url.split('/')[2].replace(/^www\./, '');
    } catch {
      return url;
    }
  }

  rankResults(query, results) {
    const queryTerms = query.toLowerCase().split(/\s+/);
    const queryRegex = new RegExp(queryTerms.join('|'), 'gi');
    
    const exactMatch = new RegExp(`^${query}$`, 'i');
    const startsWith = new RegExp(`^${query}`, 'i');
    const containsExact = new RegExp(`\\b${query}\\b`, 'i');
    
    return results
      .map(result => {
        let score = result.relevance || 0;
        const domain = this.extractDomain(result.url);
        const title = result.title.toLowerCase();
        const description = (result.description || '').toLowerCase();

        if (exactMatch.test(domain)) score += 2000;
        if (exactMatch.test(title)) score += 1500;
        if (startsWith.test(domain)) score += 1000;
        if (startsWith.test(title)) score += 800;
        if (containsExact.test(title)) score += 600;
        
        const matches = (title + ' ' + description).match(queryRegex) || [];
        score += matches.length * 50;

        if (domain.includes(query.toLowerCase())) {
          score += 1500;
          if (domain.endsWith('.com')) score += 200;
        }

        if (title.length > 100) score -= 100;
        if (description.length > 300) score -= 50;

        return { ...result, score };
      })
      .sort((a, b) => b.score - a.score);
  }

  async getFavicon(url) {
    const domain = this.extractDomain(url);
    
    if (this.#faviconCache.has(domain)) {
      return this.#faviconCache.get(domain);
    }
    
    const faviconUrl = `https://www.google.com/s2/favicons?domain=${domain}&sz=32`;
    this.#faviconCache.set(domain, faviconUrl);
    return faviconUrl;
  }

  #faviconCache = new Map();

  displayResults() {
    this.resultsContainer.innerHTML = '';
    
    if (this.currentResults.length === 0) {
      this.resultsContainer.innerHTML = '<p class="no-results">No results found. Try different keywords.</p>';
      return;
    }

    const startIndex = (this.currentPage - 1) * this.resultsPerPage;
    const endIndex = startIndex + this.resultsPerPage;
    const pageResults = this.currentResults
      .slice(startIndex, endIndex);

    pageResults.forEach(async result => {
      const resultDiv = document.createElement('div');
      resultDiv.className = 'result-item';
      
      const faviconUrl = await this.getFavicon(result.url);
      const faviconImg = faviconUrl ? `<img src="${faviconUrl}" class="site-favicon" alt="Site icon">` : '';
      
      // Limit description to 200 characters
      const description = (result.description || '')
        .substring(0, 200)
        .trim()
        + (result.description?.length > 200 ? '...' : '');

      resultDiv.innerHTML = `
        <div class="result-header">
          ${faviconImg}
          <a href="${result.url}" class="result-title" target="_blank" rel="noopener noreferrer">${result.title}</a>
        </div>
        <p class="result-description">${description}</p>
        <span class="result-url">${result.url}</span>
      `;
      
      this.resultsContainer.appendChild(resultDiv);
    });

    this.displayPagination();
  }

  displayPagination() {
    const totalPages = Math.ceil(this.totalResults / this.resultsPerPage);
    const paginationDiv = document.createElement('div');
    paginationDiv.className = 'pagination';
    
    const prevButton = document.createElement('button');
    prevButton.className = 'page-button';
    prevButton.textContent = '←';
    prevButton.disabled = this.currentPage === 1;
    prevButton.addEventListener('click', () => this.performSearch(this.currentPage - 1));
    paginationDiv.appendChild(prevButton);

    for (let i = Math.max(1, this.currentPage - 2); i <= Math.min(totalPages, this.currentPage + 2); i++) {
      const pageButton = document.createElement('button');
      pageButton.className = `page-button ${i === this.currentPage ? 'active' : ''}`;
      pageButton.textContent = i;
      pageButton.addEventListener('click', () => this.performSearch(i));
      paginationDiv.appendChild(pageButton);
    }

    const nextButton = document.createElement('button');
    nextButton.className = 'page-button';
    nextButton.textContent = '→';
    nextButton.disabled = this.currentPage === totalPages;
    nextButton.addEventListener('click', () => this.performSearch(this.currentPage + 1));
    paginationDiv.appendChild(nextButton);

    this.resultsContainer.appendChild(paginationDiv);
  }

  stripHtml(html) {
    const doc = new DOMParser().parseFromString(html, 'text/html');
    return doc.body.textContent || '';
  }

  getSourceIcon(source) {
    const icons = {
      ddg: '<svg class="source-icon ddg" viewBox="0 0 24 24"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2z"/></svg>',
      wiki: '<svg class="source-icon wiki" viewBox="0 0 24 24"><path d="M12 0c-6.627 0-12 5.373-12 12s5.373 12 12 12 12-5.373 12-12S17.52 2 12 2z"/></svg>',
      github: '<svg class="source-icon github" viewBox="0 0 24 24"><path d="M12 0c-6.627 0-12 5.373-12 12s5.373 12 12 12 12-5.373 12-12S17.52 2 12 2z"/></svg>',
      qwant: '<svg class="source-icon qwant" viewBox="0 0 24 24"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2z"/></svg>',
      brave: '<svg class="source-icon brave" viewBox="0 0 24 24"><path d="M12 2L2 7v10l10 5 10-5V7L12 2zm0 2.333L20 8v8l-8 4-8-4V8l8-3.667V4.333z"/></svg>',
      stackoverflow: '<svg class="source-icon stackoverflow" viewBox="0 0 24 24"><path d="M12 0c-6.627 0-12 5.373-12 12s5.373 12 12 12 12-5.373 12-12S17.52 2 12 2z"/></svg>',
      reddit: '<svg class="source-icon reddit" viewBox="0 0 24 24"><path d="M12 2C6.47 2 2 6.47 2 12s4.47 10 10 10 10-4.47 10-10S17.53 2 12 2zm0 18c-4.41 0-8-3.59-8-8s3.59-8 8-8 8 3.59 8 8-3.59 8-8 8z"/></svg>',
      bing: '<svg class="source-icon bing" viewBox="0 0 24 24"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2z"/></svg>'
    };
    return icons[source] || '';
  }

  extractTitle(url) {
    try {
      return decodeURIComponent(url.split('/').pop().replace(/_/g, ' '));
    } catch {
      return url;
    }
  }

}

new SearchEngine();