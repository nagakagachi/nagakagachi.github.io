(() => {
  const input = document.getElementById('title-query');
  const items = Array.from(document.querySelectorAll('#title-index > li'));
  const normalize = value => value.normalize('NFKC').toLocaleLowerCase('ja').trim();
  const titles = items.map(item => normalize(item.querySelector('.index-title').textContent));
  const count = document.getElementById('search-count');
  const empty = document.getElementById('no-matches');
  function filter() {
    const query = normalize(input.value);
    let visible = 0;
    items.forEach((item, index) => {
      item.hidden = !titles[index].includes(query);
      if (!item.hidden) visible++;
    });
    count.textContent = query ? `${visible} / ${items.length}記事` : `${items.length}記事`;
    empty.hidden = visible !== 0;
  }
  document.getElementById('title-search').hidden = false;
  input.addEventListener('input', filter);
  document.getElementById('clear-query').addEventListener('click', () => {
    input.value = '';
    filter();
    input.focus();
  });
})();
