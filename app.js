class SearchEngine {
  constructor() {
    this.settings = this.loadSettings();
    
    if (!localStorage.getItem('landingPageSeen')) {
      this.showLandingPage();
      return;
    }
    
    document.body.className = `${this.settings.darkMode ? 'dark-mode' : ''} bg-${this.settings.background}`;
    if (this.settings.background === 'custom' && this.settings.customBackground) {
      document.body.style.background = `${this.settings.darkMode ? '#121212' : '#f5f5f5'} url(${this.settings.customBackground}) center/cover fixed no-repeat`;
    } else {
      document.body.style.background = '';
    }
    
    this.searchInput = document.getElementById('searchInput');
    this.searchButton = document.getElementById('searchButton');
    this.resultsContainer = document.getElementById('resultsContainer');
    this.currentPage = 1;
    this.resultsPerPage = this.settings.resultsPerPage;
    this.totalResults = 0;
    this.currentResults = [];
    this.isLoading = false;
    this.seenDomains = new Set();
    this.cache = new Map();
    this.abortController = null;
    this.searchTimeout = null;
    
    this.setupEventListeners();
    this.initializeTheme();
    this.applySettings();
  }

  applySettings() {
    if (this.settings.autoFocus) {
      this.searchInput.focus();
    }

    document.body.classList.toggle('no-animations', !this.settings.enableAnimations);

    if (this.settings.instantSearch) {
      this.searchInput.addEventListener('input', () => {
        clearTimeout(this.searchTimeout);
        this.searchTimeout = setTimeout(() => {
          if (this.searchInput.value.trim()) {
            this.performSearch();
          }
        }, 300);
      });
    }

    if (this.settings.rememberSearches) {
      const recentSearches = JSON.parse(localStorage.getItem('recentSearches') || '[]');
      const datalist = document.createElement('datalist');
      datalist.id = 'recent-searches';
      recentSearches.forEach(search => {
        const option = document.createElement('option');
        option.value = search;
        datalist.appendChild(option);
      });
      document.body.appendChild(datalist);
      this.searchInput.setAttribute('list', 'recent-searches');
    }
  }

  saveRecentSearch(query) {
    if (this.settings.rememberSearches && query.trim()) {
      let recentSearches = JSON.parse(localStorage.getItem('recentSearches') || '[]');
      recentSearches = recentSearches.filter(search => search !== query);
      recentSearches.unshift(query);
      if (recentSearches.length > 5) recentSearches.pop();
      localStorage.setItem('recentSearches', JSON.stringify(recentSearches));
      this.updateSearchSuggestions();
    }
  }

  async performSearch(page = 1) {
    const query = this.searchInput.value.trim().toLowerCase(); // Convert to lowercase here
    if (!query) return;

    this.saveRecentSearch(query);

    if (this.abortController) {
      this.abortController.abort();
    }
    this.abortController = new AbortController();

    if (query === "69") {
      document.querySelector('h1').classList.add('funny-title');
      document.querySelector('h1').innerHTML = 'Funny<span class="accent">.</span>';
      document.querySelector('.tagline').classList.add('funny-tagline');
    } else {
      document.querySelector('h1').classList.remove('funny-title');
      document.querySelector('h1').innerHTML = 'This<span class="accent">.</span>';
      document.querySelector('.tagline').classList.remove('funny-tagline');
    }

    this.currentPage = page;
    this.resultsContainer.innerHTML = '<div class="loading-spinner"></div>';
    this.isLoading = true;

    try {
      const results = await Promise.all([
        this.fetchDomainMatch(query),
        this.fetchWithTimeout(this.fetchFromWikipedia(query), 800),
        this.fetchWithTimeout(this.fetchFromGithub(query), 800),
        this.fetchWithTimeout(this.fetchFromStackExchange(query), 800),
        this.fetchWithTimeout(this.fetchFromHackerNews(query), 800),
        this.fetchWithTimeout(this.fetchFromLibrary(query), 800)
      ]);

      if (this.abortController.signal.aborted) return;

      const processedResults = await Promise.all(
        results.flat()
          .filter(Boolean)
          .map(result => this.processSearchResult(result))
      );

      const rankedResults = this.limitResultsPerDomain(
        this.rankResults(query, processedResults)
      );

      this.cache.set(`${query}-${page}`, rankedResults);
      
      if (this.cache.size > 20) {
        const firstKey = this.cache.keys().next().value;
        this.cache.delete(firstKey);
      }

      this.currentResults = rankedResults;
      this.totalResults = rankedResults.length;
      this.displayResults();
    } catch (error) {
      if (error.name === 'AbortError') return;
      this.resultsContainer.innerHTML = '<p class="error">An error occurred while searching. Please try again.</p>';
    } finally {
      this.isLoading = false;
    }
  }

  async fetchWithTimeout(promise, timeoutMs) {
    try {
      const timeoutPromise = new Promise((_, reject) => {
        setTimeout(() => reject(new Error('timeout')), timeoutMs);
      });
      return await Promise.race([promise, timeoutPromise]);
    } catch (e) {
      return [];
    }
  }

  async fetchDomainMatch(query) {
    const cleanQuery = query.toLowerCase()
      .replace(/[^a-z0-9]/g, '')
      .replace(/\s+/g, '');
    
    const tlds = ['com', 'net', 'org', 'io', 'app', 'dev', 'ai', 'co',
      'me', 'info', 'biz', 'edu', 'gov', 'int', 'mil',
      'name', 'pro', 'aero', 'asia', 'cat', 'coop', 'jobs',
      'mobi', 'museum', 'tel', 'travel', 'xyz', 'tech', 'de', 'co.uk'];
    
    const results = await Promise.all(tlds.map(async tld => {
      const domain = `${cleanQuery}.${tld}`;
      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 500);
        
        const response = await fetch(`https://${domain}`, {
          method: 'HEAD',
          mode: 'no-cors',
          signal: controller.signal
        });
        
        clearTimeout(timeout);
        
        return {
          title: `${cleanQuery}.${tld}`,
          url: `https://${domain}`,
          description: 'This website has no description',
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
      `https://en.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(query)}&format=json&origin=*`,
      { signal: this.abortController.signal }
    );
    
    if (!response.ok) return [];
    
    const data = await response.json();
    return data.query.search.slice(0, 5).map(result => ({
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
    
    // Enhanced semantic scoring
    const semanticWeights = {
      'search': ['find', 'lookup', 'query', 'explore', 'discover'],
      'download': ['install', 'get', 'obtain', 'acquire', 'fetch'],
      'video': ['watch', 'stream', 'movie', 'film', 'youtube', 'vimeo'],
      'music': ['listen', 'song', 'audio', 'spotify', 'soundcloud'],
      'shop': ['buy', 'purchase', 'store', 'amazon', 'ebay'],
      'news': ['article', 'blog', 'post', 'update', 'latest'],
      'learn': ['tutorial', 'guide', 'course', 'education', 'training'],
      'social': ['network', 'community', 'connect', 'share', 'facebook', 'twitter'],
      'code': ['programming', 'developer', 'software', 'github', 'gitlab'],
      'image': ['picture', 'photo', 'graphic', 'instagram', 'flickr'],
      'game': ['play', 'gaming', 'steam', 'xbox', 'playstation'],
      'book': ['read', 'ebook', 'kindle', 'literature', 'novel'],
      'travel': ['flight', 'hotel', 'vacation', 'booking', 'trip'],
      'food': ['recipe', 'restaurant', 'cooking', 'menu', 'meal'],
      'health': ['medical', 'fitness', 'exercise', 'wellness', 'doctor']
    };

    return results
      .map(result => {
        let score = result.relevance || 0;
        const domain = this.extractDomain(result.url).toLowerCase();
        const title = result.title.toLowerCase();
        const description = (result.description || 'This website has no description').toLowerCase();
        const url = result.url.toLowerCase();

        // Exact domain matches get highest priority
        if (exactMatch.test(domain)) score += 8000;
        if (startsWith.test(domain)) score += 6000;
        if (domain.includes(query)) score += 5000;

        // Title relevance
        if (exactMatch.test(title)) score += 7000;
        if (startsWith.test(title)) score += 5000;
        if (containsExact.test(title)) score += 4000;

        // URL path relevance
        if (url.includes(query)) score += 3000;
        
        // Enhanced term proximity scoring
        const content = `${title} ${description}`;
        const words = content.split(/\s+/);
        let proximityScore = 0;
        
        queryTerms.forEach((term, i) => {
          const termIndex = words.findIndex(w => w.includes(term));
          if (termIndex !== -1) {
            queryTerms.forEach((otherTerm, j) => {
              if (i !== j) {
                const otherIndex = words.findIndex(w => w.includes(otherTerm));
                if (otherIndex !== -1) {
                  proximityScore += 1000 / (1 + Math.abs(termIndex - otherIndex));
                }
              }
            });
          }
        });
        
        score += proximityScore;

        // Enhanced semantic relevance
        Object.entries(semanticWeights).forEach(([category, related]) => {
          if (queryTerms.some(term => term === category || related.includes(term))) {
            if (title.includes(category) || description.includes(category)) score += 2000;
            related.forEach(term => {
              if (title.includes(term)) score += 1500;
              if (description.includes(term)) score += 1000;
              if (domain.includes(term)) score += 800;
            });
          }
        });

        // Popular TLD boost
        if (domain.endsWith('.com')) score += 800;
        if (domain.endsWith('.org')) score += 600;
        if (domain.endsWith('.edu')) score += 700;
        if (domain.endsWith('.gov')) score += 700;
        if (domain.endsWith('.net')) score += 500;

        // Word order matching
        const queryPhrase = query.toLowerCase();
        if (title.includes(queryPhrase)) score += 3500;
        if (description.includes(queryPhrase)) score += 2500;

        // Length penalties
        if (title.length > 100) score -= Math.floor((title.length - 100) / 10);
        if (description.length > 300) score -= Math.floor((description.length - 300) / 20);

        return { ...result, score };
      })
      .sort((a, b) => b.score - a.score);
  }

  processSearchResult(result) {
    return {
      ...result,
      description: result.description || 'This website has no description'
    };
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
      stackoverflow: '<svg class="source-icon stackoverflow" viewBox="0 0 24 24"><path d="M13.5,8H12V13L16.28,15.54L17,14.33L13.5,12.25V8M13,3A9,9 0 0,0 4,12H1L4.96,16.03L9,12H6A7,7 0 0,1 13,5A7,7 0 0,1 20,12A7,7 0 0,1 13,19C11.07,19 9.32,18.21 8.06,16.94L6.64,18.36C8.27,20 10.5,21 13,21A9,9 0 0,0 22,12A9,9 0 0,0 13,3"/></svg>',
      reddit: '<svg class="source-icon reddit" viewBox="0 0 24 24"><path d="M17.9,17.39C17.64,16.59 16.89,16 16,16H15V13A1,1 0 0,0 14,12H8V10H10A1,1 0 0,0 11,9V7H13A2,2 0 0,0 15,5V4.59C17.93,5.77 20,8.64 20,12C20,14.08 19.2,15.97 17.9,17.39M11,19.93C7.05,19.44 4,16.08 4,12C4,11.38 4.08,10.78 4.21,10.21L9,15V16A2,2 0 0,0 11,18M12,2A10,10 0 0,0 2,12A10,10 0 0,0 12,22A10,10 0 0,0 22,12A10,10 0 0,0 12,2Z"/></svg>',
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

  loadSettings() {
    const defaultSettings = {
      darkMode: false,
      resultsPerPage: 10,
      enableAnimations: true,
      instantSearch: false,
      autoFocus: true,
      rememberSearches: false,
      background: 'plain',
      customBackground: null
    };
    
    const savedSettings = localStorage.getItem('searchSettings');
    return {
      ...defaultSettings,
      ...JSON.parse(savedSettings || '{}')
    };
  }

  saveSettings() {
    localStorage.setItem('searchSettings', JSON.stringify(this.settings));
  }

  toggleSetting(setting) {
    this.settings[setting] = !this.settings[setting];
    this.saveSettings();
    
    if (setting === 'darkMode') {
      document.body.classList.toggle('dark-mode', this.settings.darkMode);
    }
    if (setting === 'enableAnimations') {
      document.body.classList.toggle('no-animations', !this.settings.enableAnimations);
    }
  }

  showSettingsModal() {
    const modal = document.createElement('div');
    modal.className = 'settings-modal';
    modal.innerHTML = `
      <div class="settings-content">
        <h2>Settings</h2>
        <div class="settings-list">
          <div class="setting-item">
            <label>
              <input type="checkbox" ${this.settings.enableAnimations ? 'checked' : ''} data-setting="enableAnimations">
              Enable Visual Effects
            </label>
          </div>
          <div class="setting-item">
            <label>
              <input type="checkbox" ${this.settings.instantSearch ? 'checked' : ''} data-setting="instantSearch">
              Instant Search
            </label>
          </div>
          <div class="setting-item">
            <label>
              <input type="checkbox" ${this.settings.autoFocus ? 'checked' : ''} data-setting="autoFocus">
              Auto-Focus Search Bar
            </label>
          </div>
          <div class="setting-item">
            <label>
              <input type="checkbox" ${this.settings.rememberSearches ? 'checked' : ''} data-setting="rememberSearches">
              Remember Recent Searches
            </label>
          </div>
          <div class="setting-item">
            <label>Results per page</label>
            <select data-setting="resultsPerPage">
              <option value="5" ${this.settings.resultsPerPage === 5 ? 'selected' : ''}>5</option>
              <option value="10" ${this.settings.resultsPerPage === 10 ? 'selected' : ''}>10</option>
              <option value="20" ${this.settings.resultsPerPage === 20 ? 'selected' : ''}>20</option>
              <option value="30" ${this.settings.resultsPerPage === 30 ? 'selected' : ''}>30</option>
            </select>
          </div>
          <div class="setting-item">
            <label>Background Style</label>
            <select data-setting="background">
              <option value="plain" ${this.settings.background === 'plain' ? 'selected' : ''}>Plain</option>
              <option value="custom" ${this.settings.background === 'custom' ? 'selected' : ''}>Custom Image <span class="beta-tag">Beta</span></option>
            </select>
          </div>
          <div class="setting-item">
            <label>Custom Background</label>
            <label class="custom-file-upload">
              <input type="file" accept="image/*" id="backgroundUpload">
              Choose Image
            </label>
          </div>
        </div>
        <button class="close-settings">Close</button>
      </div>
    `;

    document.body.appendChild(modal);

    const fileInput = modal.querySelector('#backgroundUpload');
    fileInput.addEventListener('change', (e) => {
      const file = e.target.files[0];
      if (file) {
        const reader = new FileReader();
        reader.onload = (e) => {
          this.settings.customBackground = e.target.result;
          this.settings.background = 'custom';
          this.saveSettings();
          this.applyBackground();
          
          const backgroundSelect = modal.querySelector('select[data-setting="background"]');
          backgroundSelect.value = 'custom';
        };
        reader.readAsDataURL(file);
      }
    });

    modal.querySelector('.close-settings').addEventListener('click', () => {
      modal.remove();
      window.location.reload();
    });

    modal.addEventListener('click', (e) => {
      if (e.target === modal) {
        modal.remove();
        window.location.reload();
      }
    });

    modal.querySelectorAll('input[type="checkbox"]').forEach(input => {
      input.addEventListener('change', () => {
        this.toggleSetting(input.dataset.setting);
      });
    });

    modal.querySelectorAll('select').forEach(select => {
      select.addEventListener('change', (e) => {
        this.settings[e.target.dataset.setting] = 
          e.target.dataset.setting === 'resultsPerPage' ? 
            parseInt(e.target.value) : e.target.value;
        this.saveSettings();
        
        if (e.target.dataset.setting === 'background') {
          this.applyBackground();
        } else if (e.target.dataset.setting === 'resultsPerPage') {
          this.resultsPerPage = this.settings.resultsPerPage;
          this.displayResults();
        }
      });
    });
  }

  applyBackground() {
    document.body.className = `${this.settings.darkMode ? 'dark-mode' : ''} bg-${this.settings.background}`;
    
    if (this.settings.background === 'custom' && this.settings.customBackground) {
      document.body.style.background = '';
      const style = document.createElement('style');
      style.textContent = `
        body.bg-custom::before {
          background-image: url(${this.settings.customBackground});
        }
      `;
      const existingStyle = document.querySelector('style[data-custom-bg]');
      if (existingStyle) {
        existingStyle.remove();
      }
      style.setAttribute('data-custom-bg', 'true');
      document.head.appendChild(style);
    } else {
      const existingStyle = document.querySelector('style[data-custom-bg]');
      if (existingStyle) {
        existingStyle.remove();
      }
      document.body.style.background = '';
    }
  }

  toggleTheme() {
    this.settings.darkMode = !this.settings.darkMode;
    this.saveSettings();
    this.applyBackground();
  }

  initializeTheme() {
    this.applyBackground();
    
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

  setupEventListeners() {
    this.searchButton.addEventListener('click', () => this.performSearch());
    this.searchInput.addEventListener('keypress', (e) => {
      if (e.key === 'Enter') {
        this.performSearch();
      }
    });

    document.addEventListener('keypress', (e) => {
      if (
        document.activeElement !== this.searchInput && 
        e.key.length === 1 && 
        !e.ctrlKey && 
        !e.altKey && 
        !e.metaKey
      ) {
        this.searchInput.focus();
        if (!e.key.match(/[\x00-\x1F\x7F]/)) {  
          this.searchInput.value = e.key;
        }
      }
    });
    
    const settingsButton = document.createElement('button');
    settingsButton.className = 'settings-button';
    settingsButton.innerHTML = `
      <svg viewBox="0 0 24 24">
        <path d="M19.14,12.94c.04-.3.06-.61.06-.94c0-.32-.02-.64-.07-.94l2.03-1.58c.18-.14.23-.41.12-.61l-1.92-3.32c-.12-.22-.37-.29-.59-.22l-2.39.96c-.5-.38-1.03-.7-1.62-.94l-.36-2.54c-.04-.24-.24-.41-.48-.41h-3.84c-.24,0-.43.17-.47.41l-.36,2.54c-.59.24-1.13.57-1.62.94l-2.39-.96c-.22-.08-.47,0-.59.22L2.74,8.87c-.12.21-.08.47.12.61l2.03,1.58c-.05.3-.07.62-.07.94s.02.64.07.94l-2.03,1.58c-.18.14-.23.41-.12.61l1.92,3.32c.12.22.37.29.59.22l2.39-.96c.5.38,1.03.7,1.62.94l.36,2.54c.05.24.24.41.48.41h3.84c.24,0,.44-.17.47-.41l.36-2.54c.59-.24,1.13-.56,1.62-.94l2.39.96c.22.08.47,0,.59-.22l1.92-3.32c.12-.22.07-.47-.12-.61l-2.01-1.58zM12,15.6c-1.98,0-3.6-1.62-3.6-3.6s1.62-3.6,3.6-3.6s3.6,1.62,3.6,3.6s-1.62,3.6-3.6,3.6z"/>
      </svg>
    `;
    settingsButton.addEventListener('click', () => this.showSettingsModal());
    document.body.appendChild(settingsButton);
    
    this.setupSearchSuggestions();
  }

  setupSearchSuggestions() {
    if (this.settings.rememberSearches) {
      this.searchInput.addEventListener('focus', () => {
        this.updateSearchSuggestions();
      });

      document.addEventListener('click', (e) => {
        if (!this.searchInput.contains(e.target)) {
          const suggestions = document.querySelector('.search-suggestions');
          if (suggestions) suggestions.remove();
        }
      });
    }
  }

  updateSearchSuggestions() {
    const existingSuggestions = document.querySelector('.search-suggestions');
    if (existingSuggestions) existingSuggestions.remove();

    const recentSearches = JSON.parse(localStorage.getItem('recentSearches') || '[]');
    if (recentSearches.length === 0) return;

    const suggestionsDiv = document.createElement('div');
    suggestionsDiv.className = 'search-suggestions';

    recentSearches.forEach(search => {
      const item = document.createElement('div');
      item.className = 'search-suggestion-item';
      item.innerHTML = `
        <svg viewBox="0 0 24 24">
          <path d="M13.5,8H12V13L16.28,15.54L17,14.33L13.5,12.25V8M13,3A9,9 0 0,0 4,12H1L4.96,16.03L9,12H6A7,7 0 0,1 13,5A7,7 0 0,1 20,12A7,7 0 0,1 13,19C11.07,19 9.32,18.21 8.06,16.94L6.64,18.36C8.27,20 10.5,21 13,21A9,9 0 0,0 22,12A9,9 0 0,0 13,3"/>
        </svg>
        <span class="search-suggestion-text">${search}</span>
      `;
      
      item.addEventListener('click', () => {
        this.searchInput.value = search;
        this.performSearch();
        suggestionsDiv.remove();
      });
      
      suggestionsDiv.appendChild(item);
    });

    this.searchInput.parentElement.appendChild(suggestionsDiv);
  }

  showLandingPage() {
    document.body.innerHTML = `
      <div class="landing-container">
        <div class="theme-toggle-landing">
          <button class="theme-toggle">
            <svg viewBox="0 0 24 24">
              <path d="M12,18C11.11,18 10.26,17.8 9.5,17.45C11.56,16.5 13,14.42 13,12C13,9.58 11.56,7.5 9.5,6.55C10.26,6.2 11.11,6 12,6A6,6 0 0,1 18,12A6,6 0 0,1 12,18M20,8.69V4H15.31L12,0.69L8.69,4H4V8.69L0.69,12L4,15.31V20H8.69L12,23.31L15.31,20H20V15.31L23.31,12L20,8.69Z"/>
            </svg>
          </button>
        </div>
        <header>
          <h1>This<span class="accent">.</span></h1>
          <p class="tagline">Now<span class="accent">.</span></p>
        </header>
        
        <div class="features-list">
          <h2>Welcome to a Better Search Experience</h2>
          
          <div class="feature-grid">
            <div class="feature-item">
              <h3>Lightning Fast Search</h3>
              <p>Instant results from multiple trusted sources</p>
            </div>
            
            <div class="feature-item">
              <h3>Smart Ranking</h3>
              <p>Intelligent results ranking based on relevance</p>
            </div>
            
            <div class="feature-item">
              <h3>Privacy Focused</h3>
              <p>No tracking, no data collection, just search</p>
            </div>
            
            <div class="feature-item">
              <h3>Dark Mode</h3>
              <p>Easy on the eyes with automatic theme switching</p>
            </div>
            
            <div class="feature-item">
              <h3>Global Search</h3>
              <p>Results from multiple sources worldwide</p>
            </div>
          
            <div class="feature-item">
              <h3>Customizable Settings</h3>
              <p>Personalize your search experience</p>
            </div>
          </div>
        </div>
        
        <button id="startSearching" class="start-button">Start Searching</button>
      </div>
    `;

    document.body.className = `${this.settings.darkMode ? 'dark-mode' : ''} bg-${this.settings.background}`;

    document.querySelector('.theme-toggle').addEventListener('click', () => {
      const isDarkMode = document.body.classList.toggle('dark-mode');
      this.settings.darkMode = isDarkMode;
      this.saveSettings();
    });

    document.getElementById('startSearching').addEventListener('click', () => {
      localStorage.setItem('landingPageSeen', 'true');
      window.location.reload();
    });
  }

}

new SearchEngine();
