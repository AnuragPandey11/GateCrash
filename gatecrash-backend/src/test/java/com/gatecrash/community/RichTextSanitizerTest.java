package com.gatecrash.community;

import com.gatecrash.common.exception.BusinessValidationException;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

/**
 * The allowlist that stands between an admin's editor and every resident's feed. Pure unit test:
 * the sanitiser has no dependencies, and the cases here are about HTML, not about Spring.
 */
class RichTextSanitizerTest {

    private final RichTextSanitizer sanitizer = new RichTextSanitizer();

    @Test
    @DisplayName("Quill formatting survives: headings, emphasis, lists, alignment classes")
    void keepsEditorFormatting() {
        String html = "<h2>Water supply</h2>"
                + "<p class=\"ql-align-center\"><strong>Bold</strong> <em>it</em> <u>u</u> <s>s</s></p>"
                + "<ol><li data-list=\"bullet\">one</li><li data-list=\"ordered\">two</li></ol>"
                + "<blockquote>quote</blockquote>";

        String out = sanitizer.sanitize(html);

        assertThat(out)
                .contains("<h2>Water supply</h2>")
                .contains("class=\"ql-align-center\"")
                .contains("<strong>Bold</strong>")
                .contains("data-list=\"bullet\"")
                .contains("<blockquote>quote</blockquote>");
    }

    @Test
    @DisplayName("script, event handlers and javascript: links are stripped")
    void stripsActiveContent() {
        String html = "<p onclick=\"steal()\">hi<script>alert(1)</script></p>"
                + "<a href=\"javascript:alert(1)\">x</a>"
                + "<img src=\"x\" onerror=\"alert(1)\">"
                + "<p style=\"background:url(javascript:alert(1))\">styled</p>";

        String out = sanitizer.sanitize(html);

        assertThat(out)
                .doesNotContain("script")
                .doesNotContain("onclick")
                .doesNotContain("onerror")
                .doesNotContain("javascript")
                .doesNotContain("style=");
    }

    @Test
    @DisplayName("non-Quill classes are dropped so a post cannot borrow the console's styling")
    void filtersClasses() {
        String out = sanitizer.sanitize("<p class=\"ql-indent-1 fixed inset-0 z-50\">x</p>");

        assertThat(out).contains("class=\"ql-indent-1\"").doesNotContain("fixed");
    }

    @Test
    @DisplayName("links open safely in a new tab")
    void hardensLinks() {
        String out = sanitizer.sanitize("<p><a href=\"https://example.com\" target=\"_self\">site</a></p>");

        assertThat(out)
                .contains("href=\"https://example.com\"")
                .contains("target=\"_blank\"")
                .contains("rel=\"noopener noreferrer nofollow\"");
    }

    @Test
    @DisplayName("raster data-URI images are kept; SVG data URIs are not")
    void imagePolicy() {
        String png = "<p><img src=\"data:image/png;base64,iVBORw0KGgo=\"></p>";
        String svg = "<p>x<img src=\"data:image/svg+xml;base64,PHN2Zz4=\"></p>";

        assertThat(sanitizer.sanitize(png)).contains("data:image/png;base64,iVBORw0KGgo=");
        assertThat(sanitizer.sanitize(svg)).doesNotContain("<img");
    }

    @Test
    @DisplayName("video embeds are limited to YouTube and Vimeo")
    void videoPolicy() {
        String youtube = "<iframe class=\"ql-video\" src=\"https://www.youtube.com/embed/abc\"></iframe>";
        String other = "<p>x</p><iframe src=\"https://evil.example/embed\"></iframe>";

        assertThat(sanitizer.sanitize(youtube)).contains("https://www.youtube.com/embed/abc");
        assertThat(sanitizer.sanitize(other)).doesNotContain("iframe");
    }

    @Test
    @DisplayName("an empty editor is refused, not stored as a blank post")
    void emptyEditorIsRefused() {
        assertThatThrownBy(() -> sanitizer.sanitize("<p><br></p>"))
                .isInstanceOf(BusinessValidationException.class);
        assertThatThrownBy(() -> sanitizer.sanitize("<script>alert(1)</script>"))
                .isInstanceOf(BusinessValidationException.class);
    }
}
