package com.gatecrash.community;

import com.gatecrash.common.exception.BusinessValidationException;
import org.jsoup.Jsoup;
import org.jsoup.nodes.Document;
import org.jsoup.nodes.Element;
import org.jsoup.safety.Safelist;
import org.springframework.stereotype.Component;

import java.net.URI;
import java.util.Arrays;
import java.util.Locale;
import java.util.Set;
import java.util.regex.Pattern;
import java.util.stream.Collectors;

/**
 * Reduces editor HTML to the subset the community feed renders.
 *
 * <p>Post bodies come from a rich-text editor (Quill), so they are HTML by design, and every client
 * that shows the feed has to render them as HTML. That makes sanitising at the point of storage
 * the right default: one allowlist, enforced once, on the server, rather than trusting each client
 * to get it right. Clients still sanitise again before rendering, as defence in depth.
 *
 * <p>The allowlist is what Quill's toolbar can produce and nothing else:
 * <ul>
 *   <li>Block structure: paragraphs, headings, lists, blockquotes, code blocks.</li>
 *   <li>Inline formatting: bold, italic, underline, strike, links.</li>
 *   <li>{@code class} attributes, but only Quill's own {@code ql-*} tokens (alignment, indent, font).</li>
 *   <li>Images as https URLs or as {@code data:} URIs of a raster type. There is no upload endpoint
 *       yet (FRONTEND.md section 15.1), so a picked file arrives inline; SVG is refused because it
 *       can carry script.</li>
 *   <li>Video embeds, as iframes pointing at YouTube or Vimeo only.</li>
 * </ul>
 * No inline styles, no event handlers, no {@code javascript:} anything.
 */
@Component
public class RichTextSanitizer {

    private static final Set<String> VIDEO_HOSTS = Set.of(
            "www.youtube.com", "youtube.com", "www.youtube-nocookie.com", "player.vimeo.com");

    private static final Set<String> LIST_KINDS = Set.of("bullet", "ordered", "checked", "unchecked");

    private static final Pattern QUILL_CLASS = Pattern.compile("^ql-[a-z0-9-]{1,40}$");

    private static final Pattern DATA_IMAGE =
            Pattern.compile("^data:image/(png|jpeg|jpg|gif|webp);base64,[A-Za-z0-9+/=\\s]+$");

    private static final Safelist SAFELIST = new Safelist()
            .addTags("p", "br", "strong", "b", "em", "i", "u", "s", "strike", "a",
                    "ol", "ul", "li", "h1", "h2", "h3", "blockquote", "pre", "code",
                    "span", "div", "sub", "sup", "img", "iframe")
            .addAttributes(":all", "class")
            .addAttributes("a", "href", "target")
            .addAttributes("li", "data-list")
            .addAttributes("img", "src", "alt", "width", "height")
            .addAttributes("iframe", "src", "frameborder", "allowfullscreen")
            .addProtocols("a", "href", "http", "https", "mailto", "tel")
            .addProtocols("img", "src", "http", "https", "data")
            .addProtocols("iframe", "src", "https")
            .addEnforcedAttribute("a", "rel", "noopener noreferrer nofollow");

    /**
     * @return the sanitised HTML, never blank
     * @throws BusinessValidationException if nothing renderable survives -- an empty editor still
     *         submits {@code <p><br></p>}, which bean validation sees as non-blank
     */
    public String sanitize(String html) {
        // Pretty-printing off at both steps: it inserts whitespace, which changes what a <pre>
        // block shows and turns inline spacing into stray text nodes.
        String cleaned = Jsoup.clean(html == null ? "" : html, "", SAFELIST,
                new Document.OutputSettings().prettyPrint(false));
        Document document = Jsoup.parseBodyFragment(cleaned);
        document.outputSettings().prettyPrint(false);
        Element body = document.body();

        for (Element element : body.select("[class]")) {
            String kept = Arrays.stream(element.attr("class").split("\\s+"))
                    .filter(token -> QUILL_CLASS.matcher(token).matches())
                    .collect(Collectors.joining(" "));
            if (kept.isEmpty()) {
                element.removeAttr("class");
            } else {
                element.attr("class", kept);
            }
        }
        for (Element item : body.select("li[data-list]")) {
            if (!LIST_KINDS.contains(item.attr("data-list"))) {
                item.removeAttr("data-list");
            }
        }
        for (Element image : body.select("img")) {
            String src = image.attr("src");
            boolean ok = src.regionMatches(true, 0, "data:", 0, 5)
                    ? DATA_IMAGE.matcher(src).matches()
                    : src.toLowerCase(Locale.ROOT).startsWith("https://")
                            || src.toLowerCase(Locale.ROOT).startsWith("http://");
            if (!ok) {
                image.remove();
            }
        }
        for (Element frame : body.select("iframe")) {
            if (!isAllowedVideo(frame.attr("src"))) {
                frame.remove();
            }
        }
        for (Element link : body.select("a[target]")) {
            link.attr("target", "_blank");
        }

        boolean hasText = !body.text().isBlank();
        boolean hasMedia = !body.select("img, iframe").isEmpty();
        if (!hasText && !hasMedia) {
            throw new BusinessValidationException("POST_BODY_EMPTY", "The post has no content.");
        }
        return body.html();
    }

    private boolean isAllowedVideo(String src) {
        try {
            URI uri = URI.create(src);
            return "https".equalsIgnoreCase(uri.getScheme())
                    && uri.getHost() != null
                    && VIDEO_HOSTS.contains(uri.getHost().toLowerCase(Locale.ROOT));
        } catch (IllegalArgumentException ex) {
            return false;
        }
    }
}
