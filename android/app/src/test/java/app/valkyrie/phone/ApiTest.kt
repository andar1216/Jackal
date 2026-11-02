package app.valkyrie.phone

import org.junit.Assert.assertEquals
import org.junit.Test

class ApiTest {
    @Test
    fun aWebAddressGetsHttps() {
        assertEquals("https://sattire.ngrok.dev", Api.cleanAddress("sattire.ngrok.dev"))
        assertEquals("https://sattire.ngrok.dev", Api.cleanAddress("  https://sattire.ngrok.dev/ "))
        assertEquals("https://sattire.ngrok.dev", Api.cleanAddress("sattire.ngrok.dev/api"))
    }

    @Test
    fun anAddressOnYourOwnNetworkGetsPlainHttp() {
        assertEquals("http://192.168.1.94:4000", Api.cleanAddress("192.168.1.94:4000"))
        assertEquals("http://localhost:4000", Api.cleanAddress("localhost:4000"))
        assertEquals("http://nas.local:4000", Api.cleanAddress("nas.local:4000"))
    }

    @Test
    fun whatThePersonTypedWithASchemeIsKept() {
        assertEquals("http://192.168.1.94:4000", Api.cleanAddress("http://192.168.1.94:4000/"))
    }
}
