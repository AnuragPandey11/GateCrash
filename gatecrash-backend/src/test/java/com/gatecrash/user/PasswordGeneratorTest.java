package com.gatecrash.user;

import com.gatecrash.config.AppProperties;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import java.util.HashSet;
import java.util.List;
import java.util.Set;
import java.util.stream.IntStream;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

@DisplayName("Generated credentials")
class PasswordGeneratorTest {

    private final PasswordGenerator generator = new PasswordGenerator(properties());

    @Test
    @DisplayName("passwords honour the configured length")
    void respectsLength() {
        assertThat(generator.generate()).hasSize(12);
        assertThat(generator.generate(20)).hasSize(20);
    }

    @Test
    @DisplayName("every password mixes upper, lower and digits")
    void alwaysMixesCharacterClasses() {
        for (int i = 0; i < 200; i++) {
            String password = generator.generate();
            assertThat(password.chars().anyMatch(Character::isUpperCase)).isTrue();
            assertThat(password.chars().anyMatch(Character::isLowerCase)).isTrue();
            assertThat(password.chars().anyMatch(Character::isDigit)).isTrue();
        }
    }

    @Test
    @DisplayName("visually ambiguous characters are excluded")
    void avoidsAmbiguousCharacters() {
        for (int i = 0; i < 200; i++) {
            assertThat(generator.generate(24)).doesNotContain("O", "0", "l", "1", "I");
        }
    }

    @Test
    @DisplayName("output does not repeat across many draws")
    void isNotPredictable() {
        Set<String> seen = new HashSet<>();
        IntStream.range(0, 1000).forEach(i -> seen.add(generator.generate()));
        assertThat(seen).hasSize(1000);
    }

    @Test
    @DisplayName("the guaranteed characters are not pinned to fixed positions")
    void guaranteedCharactersAreShuffled() {
        // Without the shuffle, position 0 would always be uppercase.
        List<String> samples = IntStream.range(0, 200).mapToObj(i -> generator.generate()).toList();
        assertThat(samples).anyMatch(password -> !Character.isUpperCase(password.charAt(0)));
    }

    @Test
    @DisplayName("PINs are numeric and the requested width")
    void generatesNumericPins() {
        for (int i = 0; i < 200; i++) {
            String pin = generator.generateNumericPin(6);
            assertThat(pin).hasSize(6).containsOnlyDigits();
        }
    }

    @Test
    @DisplayName("dangerously short values are refused outright")
    void rejectsUnsafeLengths() {
        assertThatThrownBy(() -> generator.generate(4)).isInstanceOf(IllegalArgumentException.class);
        assertThatThrownBy(() -> generator.generateNumericPin(2)).isInstanceOf(IllegalArgumentException.class);
        assertThatThrownBy(() -> generator.generateNumericPin(11)).isInstanceOf(IllegalArgumentException.class);
    }

    private AppProperties properties() {
        return new AppProperties(
                new AppProperties.Jwt("x".repeat(32), "gatecrash", 30, 30),
                new AppProperties.Firebase(false, null),
                new AppProperties.Visit(10, 200),
                new AppProperties.Password(12, 10, 128),
                new AppProperties.Pass(6, "y".repeat(32), 30, 50),
                new AppProperties.Security(
                        new AppProperties.Security.Cors(List.of("https://example.com")),
                        new AppProperties.Security.Login(5, 15),
                        new AppProperties.Security.Redeem(10, 1)),
                new AppProperties.Bootstrap("superadmin", "", "admin", "", "DEFAULT", false, null));
    }
}
