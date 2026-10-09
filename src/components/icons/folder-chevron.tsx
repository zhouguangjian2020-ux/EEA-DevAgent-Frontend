export function FolderChevron({ expanded }: { expanded: boolean }) {
  return <svg className={"folder-chevron-icon" + (expanded ? " is-expanded" : "")} width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true" focusable="false"><path d="m6 3 5 5-5 5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg>;
}
