/** Stop the page behind a pop-up from scrolling, without the layout shifting when the scrollbar goes away. */
export function lockScroll(lock: boolean) {
  const root = document.documentElement;
  if (lock) {
    root.style.paddingRight = `${window.innerWidth - root.clientWidth}px`;
    root.style.overflow = "hidden";
  } else {
    root.style.paddingRight = "";
    root.style.overflow = "";
  }
}
