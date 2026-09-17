/* ============================================================================
   captions.js — the one thing about a caption that cannot be decided while
   building the string: whether it actually overflows.

   "See more" used to be drawn on every clamped caption, which meant most of
   them offered to expand text that was already fully visible. Whether a
   caption is clipped depends on its own wrapping at the width it ended up
   with - which differs between a 4:5 Instagram mock, a 16:9 X card, a 300px
   phone screen and the same post again inside the spotlight - so it can only
   be answered by measuring the element after layout.

   The button is therefore emitted hidden by render-post.js and revealed here.
   A post whose caption fits shows no control at all.

   This lives apart from render-post.js on purpose: everything in there is a
   pure string builder that never touches the DOM, and this is the opposite.
   ========================================================================== */

/**
 * Show "See more" only on captions that are really clipped.
 *
 * @param {ParentNode} root  subtree to check; defaults to the whole document.
 */
export function syncCaptionMore(root = document) {
  const buttons = root.querySelectorAll?.('.cap-more') || [];
  if (!buttons.length) return;

  /*
   * Measured in one pass, then written in another.
   *
   * Reading scrollHeight forces the browser to flush pending layout; writing
   * `hidden` invalidates it again. Interleaving the two over the hundred-odd
   * captions a month of strips can hold means a full layout per caption. Split
   * in two, it is one layout for the lot.
   *
   * scrollHeight against clientHeight is the only honest test for a
   * -webkit-line-clamp box: the clamp is applied by line layout, so nothing
   * about the text itself predicts it. The 1px tolerance is for sub-pixel line
   * heights, which otherwise report a few tenths of overflow on captions that
   * plainly fit.
   */
  const wanted = [];
  for (const btn of buttons) {
    const cap = btn.previousElementSibling;
    if (!cap || !cap.classList.contains('cap')) continue;
    // Already expanded: the button says "See less" now and has to stay, or
    // there would be no way back.
    const show = !cap.classList.contains('cap--clamp')
      || cap.scrollHeight > cap.clientHeight + 1;
    wanted.push([btn, show]);
  }

  for (const [btn, show] of wanted) btn.hidden = !show;
}

/**
 * Re-check everything once the web font has landed.
 *
 * Inter's metrics differ from the fallback stack's, so a caption measured
 * before it arrives can be measured wrong in either direction. Cheap enough to
 * simply do again rather than try to predict.
 */
export function recheckCaptionsOnFontLoad() {
  document.fonts?.ready?.then(() => syncCaptionMore());
}
