import UIKit
import WebKit

final class ViewController: UIViewController {

    private var webView: WKWebView!
    private let homeURL = URL(string: "https://m.youtube.com/")!

    // 横全画面（スクリプトがプレーヤーを回転させている状態）かどうか
    private var landActive = false
    private var normalConstraints: [NSLayoutConstraint] = []
    private var landConstraints: [NSLayoutConstraint] = []

    // MARK: - 画面の向き・表示

    // アプリの画面は常に縦。横全画面はスクリプトがプレーヤーを回して表現する。
    override var supportedInterfaceOrientations: UIInterfaceOrientationMask { .portrait }
    override var preferredInterfaceOrientationForPresentation: UIInterfaceOrientation { .portrait }

    // 横全画面中はステータスバーとホームバーを隠す
    override var prefersStatusBarHidden: Bool { landActive }
    override var prefersHomeIndicatorAutoHidden: Bool { landActive }
    override var preferredScreenEdgesDeferringSystemGestures: UIRectEdge { landActive ? .all : [] }

    // MARK: - 起動

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = .systemBackground

        webView = WKWebView(frame: .zero, configuration: makeConfiguration())
        webView.translatesAutoresizingMaskIntoConstraints = false
        webView.navigationDelegate = self
        webView.uiDelegate = self
        webView.allowsBackForwardNavigationGestures = true   // 端からスワイプで戻る
        webView.isOpaque = false
        webView.backgroundColor = .systemBackground
        webView.scrollView.contentInsetAdjustmentBehavior = .never
        view.addSubview(webView)

        // 通常時：ノッチとホームバーを避ける / 横全画面時：画面いっぱい
        let safe = view.safeAreaLayoutGuide
        normalConstraints = [
            webView.topAnchor.constraint(equalTo: safe.topAnchor),
            webView.bottomAnchor.constraint(equalTo: safe.bottomAnchor),
            webView.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            webView.trailingAnchor.constraint(equalTo: view.trailingAnchor),
        ]
        landConstraints = [
            webView.topAnchor.constraint(equalTo: view.topAnchor),
            webView.bottomAnchor.constraint(equalTo: view.bottomAnchor),
            webView.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            webView.trailingAnchor.constraint(equalTo: view.trailingAnchor),
        ]
        NSLayoutConstraint.activate(normalConstraints)

        // 引っ張って更新
        let refresh = UIRefreshControl()
        refresh.addTarget(self, action: #selector(pullToRefresh(_:)), for: .valueChanged)
        webView.scrollView.refreshControl = refresh

        // スマホの向きを見張る（回転ロック中は通知が来ないので、自動全画面も起きない）
        UIDevice.current.beginGeneratingDeviceOrientationNotifications()
        NotificationCenter.default.addObserver(
            self,
            selector: #selector(deviceOrientationChanged),
            name: UIDevice.orientationDidChangeNotification,
            object: nil
        )

        // 広告サーバーへの通信を止めるルールを準備してから読み込む
        WKContentRuleListStore.default().compileContentRuleList(
            forIdentifier: "ytlite-block",
            encodedContentRuleList: Self.blockRules
        ) { [weak self] list, _ in
            DispatchQueue.main.async {
                guard let self else { return }
                if let list {
                    self.webView.configuration.userContentController.add(list)
                }
                self.webView.load(URLRequest(url: self.homeURL))
            }
        }
    }

    private func makeConfiguration() -> WKWebViewConfiguration {
        let config = WKWebViewConfiguration()
        config.allowsInlineMediaPlayback = true              // 全画面にせずその場で再生
        config.allowsPictureInPictureMediaPlayback = true     // PiP
        config.mediaTypesRequiringUserActionForPlayback = []  // 自動再生をブロックしない
        // Safariと同じ名乗り方にする（Googleのログイン画面で弾かれないように）
        config.applicationNameForUserAgent = "Version/18.0 Mobile/15E148 Safari/604.1"
        if #available(iOS 15.4, *) {
            config.preferences.isElementFullscreenEnabled = true
        }

        let content = WKUserContentController()
        // 「アプリ版で動いている」目印を先に置く
        content.addUserScript(WKUserScript(
            source: "window.__YTLITE_APP__ = true;",
            injectionTime: .atDocumentStart,
            forMainFrameOnly: true,
            in: .page
        ))
        // Safari版と同じスクリプトを読み込む
        if let url = Bundle.main.url(forResource: "yt-lite.user", withExtension: "js"),
           let source = try? String(contentsOf: url, encoding: .utf8) {
            content.addUserScript(WKUserScript(
                source: source,
                injectionTime: .atDocumentStart,
                forMainFrameOnly: true,
                in: .page
            ))
        }
        // スクリプトからの連絡（横全画面のオン/オフ）を受け取る
        content.add(WeakScriptMessageHandler(self), contentWorld: .page, name: "ytLite")
        config.userContentController = content
        return config
    }

    // MARK: - 横全画面の切り替え

    private func setLand(_ on: Bool) {
        guard on != landActive else { return }
        landActive = on
        if on {
            NSLayoutConstraint.deactivate(normalConstraints)
            NSLayoutConstraint.activate(landConstraints)
        } else {
            NSLayoutConstraint.deactivate(landConstraints)
            NSLayoutConstraint.activate(normalConstraints)
        }
        view.backgroundColor = on ? .black : .systemBackground
        webView.allowsBackForwardNavigationGestures = !on
        webView.scrollView.refreshControl?.isEnabled = !on
        setNeedsStatusBarAppearanceUpdate()
        setNeedsUpdateOfHomeIndicatorAutoHidden()
        setNeedsUpdateOfScreenEdgesDeferringSystemGestures()
        view.layoutIfNeeded()
    }

    @objc private func deviceOrientationChanged() {
        let dir: Int
        switch UIDevice.current.orientation {
        case .landscapeLeft:  dir = 1    // 左に倒した
        case .landscapeRight: dir = -1   // 右に倒した
        case .portrait:       dir = 0
        default: return                   // 平置き・逆さまは無視
        }
        webView.evaluateJavaScript("window.ytLite && window.ytLite.autoLand(\(dir))", completionHandler: nil)
    }

    @objc private func pullToRefresh(_ sender: UIRefreshControl) {
        webView.reload()
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.8) { sender.endRefreshing() }
    }

    // MARK: - 広告ブロックのルール

    private static let blockRules = #"""
    [
      {"trigger": {"url-filter": "^https?://([^/]+\\.)?doubleclick\\.net"}, "action": {"type": "block"}},
      {"trigger": {"url-filter": "^https?://([^/]+\\.)?googlesyndication\\.com"}, "action": {"type": "block"}},
      {"trigger": {"url-filter": "^https?://([^/]+\\.)?googleadservices\\.com"}, "action": {"type": "block"}},
      {"trigger": {"url-filter": "^https?://([^/]+\\.)?youtube\\.com/pagead/"}, "action": {"type": "block"}},
      {"trigger": {"url-filter": "^https?://([^/]+\\.)?youtube\\.com/api/stats/ads"}, "action": {"type": "block"}}
    ]
    """#
}

// MARK: - スクリプトからの連絡

extension ViewController: WKScriptMessageHandler {
    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        guard let body = message.body as? [String: Any] else { return }
        if let land = body["land"] as? Bool {
            setLand(land)
        }
    }
}

// MARK: - ページ移動の扱い

extension ViewController: WKNavigationDelegate, WKUIDelegate {
    func webView(
        _ webView: WKWebView,
        decidePolicyFor navigationAction: WKNavigationAction,
        decisionHandler: @escaping (WKNavigationActionPolicy) -> Void
    ) {
        let scheme = navigationAction.request.url?.scheme?.lowercased() ?? ""
        // youtube:// などアプリを開こうとするリンクは無視して、このアプリ内にとどまる
        if ["http", "https", "about", "blob", "data"].contains(scheme) {
            decisionHandler(.allow)
        } else {
            decisionHandler(.cancel)
        }
    }

    // 新しいタブで開くリンクは、同じ画面で開く
    func webView(
        _ webView: WKWebView,
        createWebViewWith configuration: WKWebViewConfiguration,
        for navigationAction: WKNavigationAction,
        windowFeatures: WKWindowFeatures
    ) -> WKWebView? {
        if navigationAction.targetFrame == nil, let url = navigationAction.request.url {
            webView.load(URLRequest(url: url))
        }
        return nil
    }

    // ページの処理が落ちたら読み込み直す
    func webViewWebContentProcessDidTerminate(_ webView: WKWebView) {
        webView.reload()
    }
}

// 画面とスクリプトの間で参照がループしてメモリに残り続けないようにするための中継役
@MainActor
final class WeakScriptMessageHandler: NSObject, WKScriptMessageHandler {
    private weak var target: WKScriptMessageHandler?

    init(_ target: WKScriptMessageHandler) {
        self.target = target
    }

    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        target?.userContentController(userContentController, didReceive: message)
    }
}
