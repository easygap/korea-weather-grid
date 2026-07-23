package io.github.easygap.weathergrid.config;

import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

class MapProviderPropertiesTest {

    @Test
    void acceptsAnEmptyOrHexadecimalJavascriptKey() {
        MapProviderProperties empty = new MapProviderProperties("  ");
        MapProviderProperties configured = new MapProviderProperties("a".repeat(32));

        assertFalse(empty.kakaoEnabled());
        assertEquals("", empty.kakaoJavascriptKey());
        assertTrue(configured.kakaoEnabled());
        assertEquals("a".repeat(32), configured.kakaoJavascriptKey());
    }

    @Test
    void rejectsMalformedKeysBeforeTheApplicationStarts() {
        assertThrows(IllegalArgumentException.class,
                () -> new MapProviderProperties("not-a-javascript-key"));
    }
}
