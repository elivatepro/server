function initDocument() {
  /*
   * Callout fold/unfold
   */
  document.querySelectorAll('.callout.is-collapsible > .callout-title')
    .forEach(titleEl => {
      // Add a listener on the title element
      titleEl.addEventListener('click', () => {
        const calloutEl = titleEl.parentElement;
        // Toggle the collapsed class
        calloutEl.classList.toggle('is-collapsed');
        titleEl.querySelector('.callout-fold').classList.toggle('is-collapsed');
        // Show/hide the content
        calloutEl.querySelector('.callout-content').style.display = calloutEl.classList.contains('is-collapsed') ? 'none' : '';
      });
    });

  /*
   * List fold/unfold
   */
  document.querySelectorAll('.list-collapse-indicator')
    .forEach(collapseEl => {
      collapseEl.addEventListener('click', () => {
        // Toggle the collapsed class
        collapseEl.classList.toggle('is-collapsed');
        collapseEl.parentElement.classList.toggle('is-collapsed');
      });
    });

  /*
   * Heading fold/unfold
   *
   * Obsidian's reading view lays the note out as a flat list of sibling `.el-*`
   * blocks, so a heading's content is the blocks that follow it rather than its
   * children. CSS can't hide following siblings (the way it can for lists), so
   * we hide them directly, stopping at the next heading of the same or higher
   * level. When re-expanding we skip over any sub-heading that is itself folded
   * so nested folds are preserved.
   */
  function foldHeading(indicatorEl, collapse) {
    const heading = indicatorEl.closest('h1, h2, h3, h4, h5, h6');
    const block = heading && heading.closest('div[class^="el-h"]');
    if (!block) return;
    const level = Number(heading.tagName[1]);
    indicatorEl.classList.toggle('is-collapsed', collapse);
    block.classList.toggle('is-collapsed', collapse);
    let sibling = block.nextElementSibling;
    while (sibling) {
      const match = sibling.className.match(/\bel-h([1-6])\b/);
      const siblingLevel = match ? Number(match[1]) : 0;
      // Stop at the next heading of the same or higher level.
      if (siblingLevel && siblingLevel <= level) break;
      if (collapse) {
        sibling.style.display = 'none';
        sibling = sibling.nextElementSibling;
        continue;
      }
      sibling.style.display = '';
      const subIndicator = siblingLevel ? sibling.querySelector('.heading-collapse-indicator') : null;
      if (subIndicator && subIndicator.classList.contains('is-collapsed')) {
        // This sub-heading is folded; leave its own content hidden.
        sibling = sibling.nextElementSibling;
        while (sibling) {
          const subMatch = sibling.className.match(/\bel-h([1-6])\b/);
          if (subMatch && Number(subMatch[1]) <= siblingLevel) break;
          sibling = sibling.nextElementSibling;
        }
        continue;
      }
      sibling = sibling.nextElementSibling;
    }
  }

  document.querySelectorAll('.heading-collapse-indicator')
    .forEach(indicatorEl => {
      indicatorEl.addEventListener('click', () => {
        foldHeading(indicatorEl, !indicatorEl.classList.contains('is-collapsed'));
      });
    });

  /*
   * Light/Dark theme toggle
   */
  const themeToggleEl = document.querySelector('#theme-mode-toggle');
  themeToggleEl.onclick = () => {
    document.body.classList.toggle('theme-dark');
    document.body.classList.toggle('theme-light');
  };

  /*
   * Copy code button
   */
  document.querySelectorAll('button.copy-code-button')
    .forEach(buttonEl => {
      buttonEl.addEventListener('click', () => {
        const codeEl = buttonEl.parentElement.querySelector('code');
        navigator.clipboard.writeText(codeEl.innerText.trim()).then();
      });
    });

  /*
   * MathJax stylesheet
   * Notes published before the server hosted the complete MathJax CHTML
   * stylesheet only carry the partial glyph CSS captured from Obsidian, so
   * their equations are missing letters (especially Greek). Those notes can't
   * be fixed without re-sharing - except that they all load this file. If the
   * note contains rendered math and isn't already linking the stylesheet, add
   * it now. Newer notes link it server-side, so this is a no-op for them.
   * https://github.com/alangrainger/share-note/issues/34
   */
  if (document.querySelector('mjx-container') &&
    !document.querySelector('link[href$="/assets/mathjax/mathjax.css"]')) {
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = window.location.origin + '/assets/mathjax/mathjax.css';
    document.head.appendChild(link);
  }

  /*
   * Responsive mobile classes
   */
  function toggleMobileClasses() {
    const mobileClasses = ['is-mobile', 'is-phone'];
    if (window.innerWidth <= 768) {
      // Is mobile
      document.body.classList.add(...mobileClasses);
    } else {
      document.body.classList.remove(...mobileClasses);
    }
  }

  toggleMobileClasses();
  window.addEventListener('resize', toggleMobileClasses);

  /*
   * Table of contents (Notion-style floating sidebar with scroll-spy)
   */
  buildTableOfContents();

  /*
   * Lucide icons
   */
  addScript(window.location.origin + '/assets/lucide.0.287.0.js', () => {
    lucide.createIcons({
      attrs: {
        class: ['callout-icon']
      },
      nameAttr: 'data-share-note-lucide'
    });
  });
}

/*
 * Build a Notion-style floating table of contents.
 *
 * Reads the rendered headings from the note, builds a fixed sidebar that lists
 * them (indented by level), highlights the heading currently in view as you
 * scroll (scroll-spy via IntersectionObserver), and smooth-scrolls on click.
 * Hidden on narrow screens via CSS. Safe to call once content is present
 * (including after decryption of encrypted notes).
 */
function buildTableOfContents() {
  // Avoid building twice (e.g. if called again after decryption).
  if (document.querySelector('.toc-sidebar')) return;

  const content = document.querySelector('.markdown-preview-sizer') || document.body;
  const headings = Array.from(content.querySelectorAll('h1, h2, h3, h4, h5, h6'))
    .filter(h => h.textContent.trim().length);

  // Don't show a TOC for short notes with too few headings.
  if (headings.length < 2) return;

  const minLevel = Math.min(...headings.map(h => Number(h.tagName[1])));

  const nav = document.createElement('nav');
  nav.className = 'toc-sidebar';
  nav.setAttribute('aria-label', 'Table of contents');

  const list = document.createElement('ul');
  list.className = 'toc-list';

  const linkFor = new Map();

  headings.forEach((heading, i) => {
    // Ensure each heading has an id to anchor to.
    if (!heading.id) {
      heading.id = 'toc-' + i + '-' + heading.textContent.trim().toLowerCase()
        .replace(/[^\w]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);
    }
    const level = Number(heading.tagName[1]);
    const li = document.createElement('li');
    li.className = 'toc-item toc-level-' + (level - minLevel + 1);

    const a = document.createElement('a');
    a.className = 'toc-link';
    a.href = '#' + heading.id;
    a.textContent = heading.textContent.trim();
    a.addEventListener('click', (e) => {
      e.preventDefault();
      heading.scrollIntoView({ behavior: 'smooth', block: 'start' });
      history.replaceState(null, '', '#' + heading.id);
    });

    li.appendChild(a);
    list.appendChild(li);
    linkFor.set(heading, a);
  });

  nav.appendChild(list);
  document.body.appendChild(nav);

  // Scroll-spy: highlight the heading nearest the top of the viewport.
  const visible = new Set();
  const observer = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (entry.isIntersecting) visible.add(entry.target);
      else visible.delete(entry.target);
    });

    let active = null;
    if (visible.size) {
      // Topmost currently-visible heading.
      active = Array.from(visible).sort((a, b) =>
        a.getBoundingClientRect().top - b.getBoundingClientRect().top)[0];
    } else {
      // Nothing intersecting: pick the last heading above the viewport top.
      for (const h of headings) {
        if (h.getBoundingClientRect().top < 100) active = h;
      }
    }

    linkFor.forEach((link, heading) => {
      link.classList.toggle('is-active', heading === active);
    });
    if (active) {
      linkFor.get(active).scrollIntoView({ block: 'nearest' });
    }
  }, { rootMargin: '0px 0px -70% 0px', threshold: 0 });

  headings.forEach(h => observer.observe(h));
}

function addScript(url, onload) {
  const script = document.createElement('script');
  script.type = 'text/javascript';
  script.src = url;
  if (onload) script.onload = onload;
  document.head.appendChild(script);
}
