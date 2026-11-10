// Links to user-supplied or externally collected URLs. Only http(s) URLs are
// rendered as links; anything else (for example javascript:) stays plain text.

export function safeExternalUrl(value: string | null | undefined): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:" ? url.href : null;
  } catch {
    return null;
  }
}

export function ExternalLink({
  href,
  children,
}: {
  href: string | null | undefined;
  children?: React.ReactNode;
}) {
  const url = safeExternalUrl(href);
  if (!url) return <>{href || "Unknown"}</>;
  return (
    <a href={url} target="_blank" rel="noopener noreferrer">
      {children ?? url}
    </a>
  );
}
