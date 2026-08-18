// Keeps --app-height in sync with the actual visible viewport via the
// VisualViewport API. 100vh/100dvh don't reliably track a mobile on-screen
// keyboard opening across all browsers - that mismatch is what let the
// browser pan the page to "reveal" a focused input, dragging the chat
// header off the top of the screen along with it.
export function initViewportHeightVar(): void {
  const vv = window.visualViewport;
  if (!vv) return;

  const update = () => {
    document.documentElement.style.setProperty('--app-height', `${vv.height}px`);
  };

  update();
  vv.addEventListener('resize', update);
  vv.addEventListener('scroll', update);
}
