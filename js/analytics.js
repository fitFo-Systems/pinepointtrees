/**
 * Google Analytics 4 — disabled until GA_MEASUREMENT_ID is set.
 *
 * To enable:
 *   1. Create a GA4 property at analytics.google.com (Admin → Create Property)
 *   2. Add a Web data stream for https://pinepointtrees.com
 *   3. Copy the Measurement ID (looks like G-XXXXXXXXXX)
 *   4. Replace the empty string below with that ID
 *   5. Commit + push — analytics start collecting on the next page load
 *
 * The snippet is a no-op until configured, so deploying with an empty ID
 * is safe.
 */
(function () {
  var GA_MEASUREMENT_ID = ''; // e.g. 'G-XXXXXXXXXX'
  if (!GA_MEASUREMENT_ID) return;

  var s = document.createElement('script');
  s.async = true;
  s.src = 'https://www.googletagmanager.com/gtag/js?id=' + GA_MEASUREMENT_ID;
  document.head.appendChild(s);

  window.dataLayer = window.dataLayer || [];
  window.gtag = function () { dataLayer.push(arguments); };
  gtag('js', new Date());
  gtag('config', GA_MEASUREMENT_ID);
})();
