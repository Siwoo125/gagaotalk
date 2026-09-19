// Presentation only: move existing nodes so text, images and handlers stay intact.
export function composePage(root, page) {
  root.dataset.page = page;
  const list = root.querySelector(':scope > .list');
  if (!list) return;
  list.classList.add('page-layout', `page-${page}`);
  const children = [...list.children];
  let section = null;
  for (const child of children) {
    if (child.classList.contains('section-title')) {
      section = document.createElement('section');
      section.className = 'page-section';
      const heading = document.createElement('h3');
      heading.className = 'section-heading';
      heading.textContent = child.textContent;
      section.append(heading);
      list.append(section);
      child.remove();
    } else if (section) {
      section.append(child);
    } else {
      child.classList.add('page-intro');
    }
  }
  if (page === 'gaga') {
    const intros = [...list.querySelectorAll(':scope > .page-intro')];
    const hero = document.createElement('div');
    hero.className = 'gaga-hero';
    list.prepend(hero);
    intros.forEach(node => hero.append(node));
  }
  if (page === 'me') {
    list.querySelector(':scope > .page-intro')?.classList.add('profile-hero');
    for (const input of list.querySelectorAll('input[type="checkbox"]')) {
      input.setAttribute('role', 'switch');
      input.setAttribute('aria-label', input.parentElement.textContent.trim());
    }
  }
}
