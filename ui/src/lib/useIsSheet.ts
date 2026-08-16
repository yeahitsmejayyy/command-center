import { useEffect, useState } from "react";

/**
 * Whether a dialog is currently presented as a bottom sheet.
 *
 * The presentation is decided in CSS by a media query, so the gesture has to
 * read the same query rather than keep its own idea of "mobile" — two
 * definitions of the breakpoint would eventually disagree, and the sheet would
 * either be draggable when it is a centred dialog or stuck when it is not.
 */
const SHEET_QUERY = "(max-width: 767px)";

export function useIsSheet(): boolean {
  const [isSheet, setIsSheet] = useState(
    () => typeof window !== "undefined" && window.matchMedia(SHEET_QUERY).matches,
  );

  useEffect(() => {
    const query = window.matchMedia(SHEET_QUERY);
    const update = () => setIsSheet(query.matches);

    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);

  return isSheet;
}
