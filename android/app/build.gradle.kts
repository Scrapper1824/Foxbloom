import groovy.json.JsonSlurper

plugins {
    id("com.android.application")
}

// The app's version is the TV web app's version (tv/package.json); versionCode = major*10000 + minor*100 + patch (0.9.7 -> 907).
val tvVersion = (JsonSlurper().parse(rootProject.file("../tv/package.json")) as Map<*, *>)["version"] as String
val (vMajor, vMinor, vPatch) = tvVersion.split("-")[0].split(".").map { it.toInt() }

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
