const close = document.querySelector<HTMLButtonElement>("button.close");

if (close) {
  close.hidden = false;
  close.addEventListener("click", () => {
    // Back to the page of DriveMD's own that led here: the Navigation API
    // counts neither the pages ahead nor another site's.
    if ("navigation" in window && navigation.canGoBack) {
      navigation.back();
      return;
    }
    // Browsers close a tab that holds only this page, and say so at once.
    window.close();
    if (!window.closed) location.assign("/");
  });
}
