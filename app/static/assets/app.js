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

function addScript(url, onload) {
  const script = document.createElement('script');
  script.type = 'text/javascript';
  script.src = url;
  if (onload) script.onload = onload;
  document.head.appendChild(script);
}
