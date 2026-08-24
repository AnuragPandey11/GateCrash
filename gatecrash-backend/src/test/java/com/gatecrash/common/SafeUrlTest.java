package com.gatecrash.common;

import com.gatecrash.common.exception.BusinessValidationException;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

@DisplayName("URL validation for client-rendered links")
class SafeUrlTest {

    @Test
    @DisplayName("an https URL passes through")
    void acceptsHttps() {
        assertThat(SafeUrl.validateHttps("https://cdn.example.com/a.jpg", "photoUrl"))
                .isEqualTo("https://cdn.example.com/a.jpg");
    }

    @Test
    @DisplayName("absent values stay absent")
    void nullAndBlankBecomeNull() {
        assertThat(SafeUrl.validateHttps(null, "photoUrl")).isNull();
        assertThat(SafeUrl.validateHttps("   ", "photoUrl")).isNull();
    }

    @ParameterizedTest
    @ValueSource(strings = {
            "javascript:alert(1)",
            "data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==",
            "http://cdn.example.com/a.jpg",
            "file:///etc/passwd",
            "vbscript:msgbox(1)",
            "not a url at all",
            "https://",
    })
    @DisplayName("hostile or non-https schemes are refused")
    void rejectsUnsafeSchemes(String candidate) {
        assertThatThrownBy(() -> SafeUrl.validateHttps(candidate, "photoUrl"))
                .isInstanceOf(BusinessValidationException.class);
    }

    @Test
    @DisplayName("embedded credentials are refused")
    void rejectsUserInfo() {
        assertThatThrownBy(() -> SafeUrl.validateHttps("https://user:pass@evil.example.com/a.jpg", "photoUrl"))
                .isInstanceOf(BusinessValidationException.class);
    }

    @Test
    @DisplayName("absurdly long URLs are refused")
    void rejectsOverlongUrls() {
        String tooLong = "https://cdn.example.com/" + "a".repeat(3000);
        assertThatThrownBy(() -> SafeUrl.validateHttps(tooLong, "photoUrl"))
                .isInstanceOf(BusinessValidationException.class);
    }
}
