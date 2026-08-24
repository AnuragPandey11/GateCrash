package com.gatecrash.config;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.gatecrash.security.AppUserDetailsService;
import com.gatecrash.security.JwtAuthFilter;
import com.gatecrash.security.JwtService;
import com.gatecrash.security.PasswordResetEnforcementFilter;
import com.gatecrash.security.RestAccessDeniedHandler;
import com.gatecrash.security.RestAuthenticationEntryPoint;
import lombok.RequiredArgsConstructor;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.http.HttpMethod;
import org.springframework.security.config.Customizer;
import org.springframework.security.config.annotation.method.configuration.EnableMethodSecurity;
import org.springframework.security.config.annotation.web.builders.HttpSecurity;
import org.springframework.security.config.annotation.web.configuration.EnableWebSecurity;
import org.springframework.security.config.http.SessionCreationPolicy;
import org.springframework.security.crypto.bcrypt.BCryptPasswordEncoder;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.security.web.SecurityFilterChain;
import org.springframework.security.web.authentication.UsernamePasswordAuthenticationFilter;
import org.springframework.security.web.header.writers.ReferrerPolicyHeaderWriter;
import org.springframework.security.web.header.writers.XXssProtectionHeaderWriter;
import org.springframework.web.cors.CorsConfiguration;
import org.springframework.web.cors.CorsConfigurationSource;
import org.springframework.web.cors.UrlBasedCorsConfigurationSource;

import java.time.Duration;
import java.util.List;

/**
 * HTTP security. Authorization is enforced in three layers and this is only the first:
 *
 * <ol>
 *   <li>the URL rules below draw the coarse public/authenticated boundary;</li>
 *   <li>{@code @PreAuthorize} on service methods enforces the role matrix;</li>
 *   <li>services re-check ownership of the specific row being touched.</li>
 * </ol>
 *
 * <p>A layer-1 rule is never allowed to be the only thing standing between a caller and data. Every
 * business endpoint below is {@code authenticated()} and nothing more -- the real decision happens
 * in the service.
 */
@Configuration
@EnableWebSecurity
@EnableMethodSecurity
@RequiredArgsConstructor
public class SecurityConfig {

    private static final String[] PUBLIC_ENDPOINTS = {
            "/api/v1/auth/login",
            "/api/v1/auth/refresh",
            "/v3/api-docs/**",
            "/swagger-ui/**",
            "/swagger-ui.html",
            "/actuator/health",
            "/actuator/health/**",
            // The STOMP handshake is unauthenticated by design; the CONNECT frame carries the JWT and
            // StompAuthChannelInterceptor rejects the session if it does not verify.
            "/ws/**"
    };

    private final JwtService jwtService;
    private final AppUserDetailsService userDetailsService;
    private final ObjectMapper objectMapper;
    private final RestAuthenticationEntryPoint authenticationEntryPoint;
    private final RestAccessDeniedHandler accessDeniedHandler;
    private final AppProperties properties;

    @Bean
    public SecurityFilterChain filterChain(HttpSecurity http) throws Exception {
        JwtAuthFilter jwtAuthFilter = new JwtAuthFilter(jwtService, userDetailsService, objectMapper);
        PasswordResetEnforcementFilter passwordResetFilter = new PasswordResetEnforcementFilter(objectMapper);

        http
                .cors(cors -> cors.configurationSource(corsConfigurationSource()))
                // Safe to disable: authentication is a bearer token in a header, never an ambient
                // cookie, so there is no credential a cross-site form post could ride on.
                .csrf(csrf -> csrf.disable())
                .sessionManagement(session -> session.sessionCreationPolicy(SessionCreationPolicy.STATELESS))
                .formLogin(form -> form.disable())
                .httpBasic(basic -> basic.disable())
                .logout(logout -> logout.disable())
                .anonymous(Customizer.withDefaults())
                .exceptionHandling(handling -> handling
                        .authenticationEntryPoint(authenticationEntryPoint)
                        .accessDeniedHandler(accessDeniedHandler))
                .headers(headers -> headers
                        .frameOptions(frame -> frame.deny())
                        .contentTypeOptions(Customizer.withDefaults())
                        .xssProtection(xss -> xss.headerValue(
                                XXssProtectionHeaderWriter.HeaderValue.ENABLED_MODE_BLOCK))
                        .referrerPolicy(referrer -> referrer.policy(
                                ReferrerPolicyHeaderWriter.ReferrerPolicy.NO_REFERRER))
                        .httpStrictTransportSecurity(hsts -> hsts
                                .includeSubDomains(true)
                                .maxAgeInSeconds(Duration.ofDays(365).toSeconds()))
                        // This service returns JSON only; a restrictive CSP costs nothing and blocks
                        // any attempt to have a browser execute a reflected response.
                        .contentSecurityPolicy(csp -> csp.policyDirectives(
                                "default-src 'none'; frame-ancestors 'none'; sandbox")))
                .authorizeHttpRequests(auth -> auth
                        .requestMatchers(HttpMethod.OPTIONS, "/**").permitAll()
                        .requestMatchers(PUBLIC_ENDPOINTS).permitAll()
                        .anyRequest().authenticated())
                // Both slot in ahead of UsernamePasswordAuthenticationFilter; insertion order is
                // preserved, so authentication runs first and the reset gate sees its result.
                .addFilterBefore(jwtAuthFilter, UsernamePasswordAuthenticationFilter.class)
                .addFilterBefore(passwordResetFilter, UsernamePasswordAuthenticationFilter.class);

        return http.build();
    }

    /**
     * BCrypt at strength 10 -- the cost the spec calls for, and the cost the seeded and previously
     * provisioned hashes were produced at. Raising it is a migration, not a config change.
     */
    @Bean
    public PasswordEncoder passwordEncoder() {
        return new BCryptPasswordEncoder(10);
    }

    /**
     * Explicit origin allowlist. {@code allowCredentials} stays false because the browser client
     * carries the token in an Authorization header, not a cookie -- so no origin ever needs the
     * credentialed-CORS relaxation, and wildcards remain safe to reject outright.
     */
    @Bean
    public CorsConfigurationSource corsConfigurationSource() {
        List<String> origins = properties.security().cors().allowedOrigins();
        if (origins.contains("*")) {
            throw new IllegalStateException("app.security.cors.allowed-origins must not contain '*'");
        }

        CorsConfiguration config = new CorsConfiguration();
        config.setAllowedOrigins(origins);
        config.setAllowedMethods(List.of("GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"));
        config.setAllowedHeaders(List.of("Authorization", "Content-Type", "X-Correlation-Id"));
        config.setExposedHeaders(List.of("X-Correlation-Id"));
        config.setAllowCredentials(false);
        config.setMaxAge(Duration.ofHours(1));

        UrlBasedCorsConfigurationSource source = new UrlBasedCorsConfigurationSource();
        source.registerCorsConfiguration("/**", config);
        return source;
    }
}
