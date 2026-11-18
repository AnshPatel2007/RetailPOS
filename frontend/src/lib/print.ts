/**
 * Print a self-contained HTML document (a Z-report, a statement) without a
 * pop-up window: it loads in a hidden frame, opens the browser's print dialog,
 * and the frame is removed afterwards. Resolves false if printing could not start.
 */
export function printHtml(html: string): Promise<boolean> {
  return new Promise(resolve => {
    try {
      const frame = document.createElement('iframe');
      frame.setAttribute('aria-hidden', 'true');
      frame.tabIndex = -1;
      Object.assign(frame.style, { position: 'fixed', right: '0', bottom: '0', width: '0', height: '0', border: '0', visibility: 'hidden' });
      frame.onload = () => {
        try {
          frame.contentWindow?.focus();
          frame.contentWindow?.print();
          resolve(true);
        } catch {
          resolve(false);
        } finally {
          // Give the print dialog time to read the page before the frame goes.
          setTimeout(() => frame.remove(), 60_000);
        }
      };
      frame.srcdoc = html;
      document.body.appendChild(frame);
    } catch {
      resolve(false);
    }
  });
}
