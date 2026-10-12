const close = document.querySelector<HTMLButtonElement>("button.close");

if (close) {
  close.hidden = false;
  close.addEventListener("click", () => {
    if (history.length > 1) {
      history.back();
      return;
    }
    // Browsers close a tab that holds only this page; one that was typed in
    // stays, and goes to the app instead.
    window.close();
    setTimeout(() => {
      location.assign("/");
    }, 100);
  });
}
