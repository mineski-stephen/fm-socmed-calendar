/* ============================================================================
   mocks.js — the one registry of platform mock renderers.

   Every view that draws a post in Layout mode looks a platform up here, so a
   new mock is wired in exactly once. Before this file the map was copied into
   both render-dayview.js and lightbox.js, which meant a platform could render
   as a mock in the day view and as a plain card in the spotlight, with nothing
   to catch it.

   The key is PLATFORM_META[key].mock. A platform whose `mock` is null - or
   names a renderer that is not here - simply has no mock, and the callers fall
   back to the simple card. That single lookup is still the only place the
   decision is made.
   ========================================================================== */

import { platformMeta } from './data.js';
import { mockFacebookHTML } from './mock-facebook.js';
import { mockInstagramHTML } from './mock-instagram.js';
import { mockXHTML } from './mock-x.js';
import { mockTikTokHTML } from './mock-tiktok.js';
import { mockYouTubeHTML } from './mock-youtube.js';
import { mockLinkedInHTML } from './mock-linkedin.js';

const MOCKS = {
  fb: mockFacebookHTML,
  ig: mockInstagramHTML,
  x:  mockXHTML,
  tt: mockTikTokHTML,
  yt: mockYouTubeHTML,
  li: mockLinkedInHTML,
};

/** The renderer for this platform, or null if it has no mock. */
export const mockFor = (platformKey) => MOCKS[platformMeta(platformKey).mock] || null;

/** The mock's markup, or '' when the platform has none. */
export function mockHTML(post, platformKey) {
  const fn = mockFor(platformKey);
  return fn ? fn(post, platformKey) : '';
}
