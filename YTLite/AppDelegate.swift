import UIKit
import AVFoundation

@main
final class AppDelegate: UIResponder, UIApplicationDelegate {
    var window: UIWindow?

    func application(
        _ application: UIApplication,
        didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]?
    ) -> Bool {
        // 動画の音声を「再生アプリ」として扱ってもらう（マナーモードでも鳴る・バックグラウンドで続く）
        // ここでは有効化まではしないので、起動しただけで他のアプリの音楽が止まることはない
        try? AVAudioSession.sharedInstance().setCategory(.playback, mode: .moviePlayback)

        let window = UIWindow(frame: UIScreen.main.bounds)
        window.rootViewController = ViewController()
        window.makeKeyAndVisible()
        self.window = window
        return true
    }

    // アプリ全体としては横も許可（iOS標準の全画面プレーヤー用）。
    // メイン画面は ViewController 側で縦に固定している。
    func application(
        _ application: UIApplication,
        supportedInterfaceOrientationsFor window: UIWindow?
    ) -> UIInterfaceOrientationMask {
        return .allButUpsideDown
    }
}
