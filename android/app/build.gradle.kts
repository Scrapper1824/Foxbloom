import groovy.json.JsonSlurper
import java.util.Properties

plugins {
    id("com.android.application")
}

// The app's version is the TV web app's version (tv/package.json); versionCode = major*10000 + minor*100 + patch (0.9.7 -> 907).
val tvVersion = (JsonSlurper().parse(rootProject.file("../tv/package.json")) as Map<*, *>)["version"] as String
val (vMajor, vMinor, vPatch) = tvVersion.split("-")[0].split(".").map { it.toInt() }

// Release signing: key.properties (storeFile, storePassword, keyAlias, keyPassword) in the key folder, which lives
// outside the repo (created once by `npm run android:key`).
val keyDir = File(System.getenv("FOXBLOOM_ANDROID_KEY_DIR") ?: "${System.getenv("APPDATA")}/Foxbloom/android")
val keyProps = File(keyDir, "key.properties")

android {
    namespace = "org.foxbloom.tv"
    compileSdk = 35
    buildToolsVersion = "37.0.0"

    defaultConfig {
        applicationId = "org.foxbloom.tv"
        minSdk = 24
        targetSdk = 35
        versionName = tvVersion
        versionCode = vMajor * 10000 + vMinor * 100 + vPatch
    }

    signingConfigs {
        create("release") {
            if (keyProps.isFile) {
                val p = Properties().apply { keyProps.inputStream().use { load(it) } }
                storeFile = file(p.getProperty("storeFile"))
                storePassword = p.getProperty("storePassword")
                keyAlias = p.getProperty("keyAlias")
                keyPassword = p.getProperty("keyPassword")
            }
        }
    }

    buildTypes {
        release {
            signingConfig = signingConfigs.getByName("release")
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
}

kotlin {
    jvmToolchain(21)
}

dependencies {
    implementation("androidx.webkit:webkit:1.18.0")
    // Media3 1.10+ needs compileSdk 36; 1.9.x is the newest line that builds against 35.
    implementation("androidx.media3:media3-exoplayer:1.9.4")
    implementation("androidx.media3:media3-ui:1.9.4")
    testImplementation("junit:junit:4.13.2")
}

// The page shown in the WebView is the TV web app's build (tv/dist), copied into the APK's assets.
abstract class CopyWebTask : DefaultTask() {
    @get:Inject abstract val fs: FileSystemOperations
    @get:InputFiles @get:PathSensitive(PathSensitivity.RELATIVE) abstract val web: ConfigurableFileCollection
    @get:Internal abstract val webDir: DirectoryProperty
    @get:OutputDirectory abstract val target: DirectoryProperty

    @TaskAction
    fun copy() {
        val dir = webDir.get().asFile
        if (!File(dir, "index.html").isFile) throw GradleException("Build the TV app first: npm run build -w tv")
        fs.sync {
            from(dir)
            into(target)
        }
    }
}

val copyWeb = tasks.register<CopyWebTask>("copyWeb") {
    webDir.set(rootProject.layout.projectDirectory.dir("../tv/dist"))
    web.from(webDir)
    target.set(layout.projectDirectory.dir("src/main/assets/web"))
}
tasks.named("preBuild") { dependsOn(copyWeb) }

// A release APK must be signed with the Foxbloom key; fail clearly rather than produce an unsigned one.
tasks.configureEach {
    if (name == "assembleRelease" || name == "packageRelease") {
        doFirst {
            if (!keyProps.isFile) throw GradleException("No Android signing key: run npm run android:key once (and back up %APPDATA%/Foxbloom/android)")
        }
    }
}
