package com.gatecrash.config;

import com.google.auth.oauth2.GoogleCredentials;
import com.google.firebase.FirebaseApp;
import com.google.firebase.FirebaseOptions;
import com.google.firebase.messaging.FirebaseMessaging;
import lombok.RequiredArgsConstructor;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.core.io.DefaultResourceLoader;
import org.springframework.core.io.Resource;

import java.io.IOException;
import java.io.InputStream;

/**
 * Wires the Firebase Admin SDK, but only when {@code app.firebase.enabled} is true.
 *
 * <p>Local development and tests run with it off: {@code FcmService} then logs what it would have
 * sent instead of requiring a real service account on every developer's laptop. Credentials are
 * loaded from a configurable resource so production can point at a mounted secret rather than
 * anything on the classpath.
 */
@Configuration
@ConditionalOnProperty(prefix = "app.firebase", name = "enabled", havingValue = "true")
@RequiredArgsConstructor
public class FirebaseConfig {

    private static final Logger log = LoggerFactory.getLogger(FirebaseConfig.class);

    private final AppProperties properties;

    @Bean
    FirebaseApp firebaseApp() throws IOException {
        if (!FirebaseApp.getApps().isEmpty()) {
            return FirebaseApp.getInstance();
        }
        String location = properties.firebase().credentials();
        Resource resource = new DefaultResourceLoader().getResource(location);
        if (!resource.exists()) {
            throw new IllegalStateException(
                    "Firebase is enabled but credentials were not found at: " + location);
        }
        try (InputStream stream = resource.getInputStream()) {
            FirebaseOptions options = FirebaseOptions.builder()
                    .setCredentials(GoogleCredentials.fromStream(stream))
                    .build();
            log.info("Initialising Firebase Admin SDK from {}", location);
            return FirebaseApp.initializeApp(options);
        }
    }

    @Bean
    FirebaseMessaging firebaseMessaging(FirebaseApp app) {
        return FirebaseMessaging.getInstance(app);
    }
}
