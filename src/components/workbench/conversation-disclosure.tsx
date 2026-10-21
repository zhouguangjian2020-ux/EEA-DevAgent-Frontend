import "./conversation-disclosure.css";

/** Shared indicator for both native details and controlled activity disclosures. */
export function ConversationDisclosureChevron({ open }: { open?: boolean }) {
  return <svg className="conversation-disclosure-chevron" data-open={open} width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true" focusable="false">
    <path d="m6 4 4 4-4 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
  </svg>;
}
