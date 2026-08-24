package com.gatecrash.config;

import lombok.RequiredArgsConstructor;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.context.event.ContextRefreshedEvent;
import org.springframework.context.event.EventListener;
import org.springframework.core.env.Environment;
import org.springframework.stereotype.Component;

import java.util.ArrayList;
import java.util.List;
import java.util.Set;

/**
 * Refuses to serve traffic with development placeholders still in place.
 *
 * <p>The single most common way a system like this is compromised is shipping with the sample JWT
 * secret from the README. Every one of these values has a working default so local development is
 * frictionless -- which is exactly why a hard failure outside local/test is necessary. A warning in
 * a log nobody reads is not a control.
 */
@Component
@RequiredArgsConstructor
public class StartupSecretsValidator {

    private static final Logger log = LoggerFactory.getLogger(StartupSecretsValidator.class);

    private static final Set<String> DEVELOPMENT_PROFILES = Set.of("local", "test");

    private static final String DEFAULT_JWT_SECRET = "change-me-32-bytes-min-in-prod-please";
    private static final String DEFAULT_PIN_PEPPER = "change-me-pass-pin-pepper-32-bytes-min";

    private final AppProperties properties;
    private final Environment environment;

    @EventListener(ContextRefreshedEvent.class)
    public void validate() {
        boolean development = List.of(environment.getActiveProfiles()).stream()
                .anyMatch(DEVELOPMENT_PROFILES::contains)
                || environment.getActiveProfiles().length == 0;

        List<String> problems = new ArrayList<>();
        if (DEFAULT_JWT_SECRET.equals(properties.jwt().secret())) {
            problems.add("app.jwt.secret is still the built-in default (set JWT_SECRET)");
        }
        if (DEFAULT_PIN_PEPPER.equals(properties.pass().pinPepper())) {
            problems.add("app.pass.pin-pepper is still the built-in default (set PASS_PIN_PEPPER)");
        }
        properties.security().cors().allowedOrigins().stream()
                .filter(origin -> !origin.startsWith("https://"))
                .forEach(origin -> problems.add("CORS origin is not https: " + origin));

        if (problems.isEmpty()) {
            return;
        }
        if (development) {
            problems.forEach(problem -> log.warn("INSECURE DEVELOPMENT CONFIGURATION: {}", problem));
            return;
        }
        throw new IllegalStateException(
                "Refusing to start with insecure configuration: " + String.join("; ", problems));
    }
}
