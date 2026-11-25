package com.example.timestamp;
import org.junit.Test;
import static org.junit.Assert.*;
public class AppUpdateTest {
    @Test public void comparesNumericVersions(){
        assertTrue(AppUpdatePlugin.compareVersion("v1.5.10","1.5.2")>0);
        assertTrue(AppUpdatePlugin.compareVersion("v1.4.4","1.5.2")<0);
        assertEquals(0,AppUpdatePlugin.compareVersion("v1.5.2","1.5.2"));
        assertEquals(0,AppUpdatePlugin.compareVersion("1.5","1.5.0"));
    }
    @Test(expected=IllegalArgumentException.class) public void rejectsPrerelease(){
        AppUpdatePlugin.compareVersion("v1.6.0-beta","1.5.2");
    }
}
