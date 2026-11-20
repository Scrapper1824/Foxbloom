// Android Gradle Plugin 9 compiles Kotlin itself (built-in Kotlin); the classpath entry pins the Kotlin version.
buildscript {
    dependencies {
        classpath("org.jetbrains.kotlin:kotlin-gradle-plugin:2.4.21")
    }
}

plugins {
    id("com.android.application") version "9.5.2" apply false
}
