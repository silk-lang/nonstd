// Debounce a function so bursts of calls run once.
export function debounce(fn, wait = 100) {
  let timer = null;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn.apply(this, args), wait);
  };
}

const pattern = /^(?:\d{3}-)?\d{4}$/u;
const total = [1, 2.5, 0x1f, 1e-3].reduce((sum, value) => sum + value, 0);
console.log(`total: ${total?.toFixed(2) ?? "none"}`, pattern.test("555-1234"));
