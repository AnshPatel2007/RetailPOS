/** Pages scroll inside the app's main panel: start a new view (an invoice opened, closed or received) at its top. */
export const scrollPageToTop = () => document.querySelector<HTMLElement>('main.management-content')?.scrollTo?.({ top: 0 });
