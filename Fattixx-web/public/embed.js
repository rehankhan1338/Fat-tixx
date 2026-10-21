/*
 * Fattixx embeddable checkout widget.
 *
 *   <script src="https://YOUR-FATTIXX-HOST/embed.js" data-event="event-slug" async></script>
 *
 * Optional attributes: data-ref="promoterCode" (tracking link code), data-key="..." (private events).
 * The widget shows ticket selection in an iframe; payment continues on Fattixx in a new tab.
 */
(function () {
  var script = document.currentScript;
  if (!script) return;
  var slug = script.getAttribute("data-event");
  if (!slug) { console.error("Fattixx embed: missing data-event"); return; }
  var origin = new URL(script.src).origin;
  var params = new URLSearchParams();
  ["ref", "key", "utm_source", "utm_medium", "utm_campaign"].forEach(function (k) {
    var v = script.getAttribute("data-" + k.replace("_", "-")) || script.getAttribute("data-" + k);
    if (v) params.set(k, v);
  });
  var iframe = document.createElement("iframe");
  iframe.src = origin + "/embed/" + encodeURIComponent(slug) + (params.toString() ? "?" + params : "");
  iframe.title = "Buy tickets";
  iframe.loading = "lazy";
  iframe.style.cssText = "width:100%;max-width:520px;border:0;height:640px;display:block;color-scheme:normal";
  script.parentNode.insertBefore(iframe, script.nextSibling);
  window.addEventListener("message", function (e) {
    if (e.origin !== origin || e.source !== iframe.contentWindow || !e.data || e.data.type !== "fattixx:height") return;
    iframe.style.height = Math.max(200, Math.min(4000, Number(e.data.height) || 640)) + "px";
  });
})();
