import UIKit
import WebKit

final class ViewController: UIViewController {

    private var webView: WKWebView!
    private let homeURL = URL(string: "https://m.youtube.com/")!

    // 横全画面（スクリプトがプレーヤーを回転させている状態）かどうか
    private var landActive = false
    private var normalConstraints: [NSLayoutConstraint] = []
    private var landConstraints: [NSLayoutConstraint] = []

    // 画面下のタブバーと、上の読み込み進行バー
    private let tabBar = UITabBar()
    private let progressView = UIProgressView(progressViewStyle: .bar)
    private var currentTab: Tab = .home
    private var urlObservation: NSKeyValueObservation?
    private var progressObservation: NSKeyValueObservation?

    private enum Tab: Int, CaseIterable {
        case home, shorts, subs, you

        var title: String {
            switch self {
            case .home:   return "ホーム"
            case .shorts: return "ショート"
            case .subs:   return "登録チャンネル"
            case .you:    return "マイページ"
            }
        }
        var symbol: String {
            switch self {
            case .home:   return "house"
            case .shorts: return "play.square.stack"
            case .subs:   return "rectangle.stack.badge.play"
            case .you:    return "person.crop.circle"
            }
        }
        // スクリプト側(goTab)での名前
        var jsName: String {
            switch self {
            case .home:   return "home"
            case .shorts: return "shorts"
            case .subs:   return "subs"
            case .you:    return "you"
            }
        }
        var path: String {
            switch self {
            case .home:   return "/"
            case .shorts: return "/shorts"
            case .subs:   return "/feed/subscriptions"
            case .you:    return "/feed/library"
            }
        }
    }

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

        // 画面下のタブバー（iPhone標準の見た目。ダークモードにも自動で追従）
        tabBar.translatesAutoresizingMaskIntoConstraints = false
        tabBar.delegate = self
        tabBar.items = Tab.allCases.map { tab in
            let item = UITabBarItem(
                title: tab.title,
                image: UIImage(systemName: tab.symbol),
                selectedImage: UIImage(systemName: tab.symbol + ".fill") ?? UIImage(systemName: tab.symbol)
            )
            item.tag = tab.rawValue
            return item
        }
        tabBar.selectedItem = tabBar.items?.first
        view.addSubview(tabBar)

        // 上の細い読み込み進行バー
        progressView.translatesAutoresizingMaskIntoConstraints = false
        progressView.trackTintColor = .clear
        progressView.progressTintColor = .systemRed
        progressView.isHidden = true
        view.addSubview(progressView)

        // 通常時：上はノッチを避け、下はタブバーの上まで
        // 横全画面時：画面いっぱい（タブバーは隠す）
        let safe = view.safeAreaLayoutGuide
        NSLayoutConstraint.activate([
            tabBar.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            tabBar.trailingAnchor.constraint(equalTo: view.trailingAnchor),
            tabBar.bottomAnchor.constraint(equalTo: view.bottomAnchor),
            tabBar.topAnchor.constraint(equalTo: safe.bottomAnchor, constant: -49),
            progressView.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            progressView.trailingAnchor.constraint(equalTo: view.trailingAnchor),
            progressView.topAnchor.constraint(equalTo: safe.topAnchor),
            progressView.heightAnchor.constraint(equalToConstant: 2),
        ])
        normalConstraints = [
            webView.topAnchor.constraint(equalTo: safe.topAnchor),
            webView.bottomAnchor.constraint(equalTo: tabBar.topAnchor),
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

        // ページが変わったら、タブの選択を合わせる（ページ内移動でも通知が来る）
        urlObservation = webView.observe(\.url, options: [.new]) { [weak self] webView, _ in
            let url = webView.url
            DispatchQueue.main.async { self?.syncTab(with: url) }
        }
        // 読み込みの進み具合を上のバーに出す
        progressObservation = webView.observe(\.estimatedProgress, options: [.new]) { [weak self] webView, _ in
            let progress = Float(webView.estimatedProgress)
            DispatchQueue.main.async { self?.updateProgress(progress) }
        }

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

        // ホームに戻る瞬間・戻ってきた瞬間を見張る（自動PiP用）
        NotificationCenter.default.addObserver(
            self,
            selector: #selector(appWillResignActive),
            name: UIApplication.willResignActiveNotification,
            object: nil
        )
        NotificationCenter.default.addObserver(
            self,
            selector: #selector(appDidBecomeActive),
            name: UIApplication.didBecomeActiveNotification,
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
        tabBar.isHidden = on
        if on { progressView.isHidden = true }
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

    // MARK: - 自動PiP

    // ホームに戻り始めた瞬間：再生中ならPiPにする。
    // アプリから実行したスクリプトはiOSに「ユーザーの操作」として扱われるので、PiPを開ける。
    @objc private func appWillResignActive() {
        webView.evaluateJavaScript(
            "window.ytLite && window.ytLite.autoPiP && window.ytLite.autoPiP()",
            completionHandler: nil
        )
    }

    // アプリに戻ってきた：自動で開いたPiPは閉じて、元の画面で続きを再生
    @objc private func appDidBecomeActive() {
        webView.evaluateJavaScript(
            "window.ytLite && window.ytLite.cancelAutoPiP && window.ytLite.cancelAutoPiP()",
            completionHandler: nil
        )
    }

    // MARK: - 裏で次の動画に切り替えるときの「つなぎ」

    // 切り替えの間に音が途切れると、iOSがアプリを眠らせて再生が止まってしまう。
    // その間だけ裏で動く時間をもらい、何度か「再生して」と押し直す。
    private var bridgeTask: UIBackgroundTaskIdentifier = .invalid

    private func setBridge(_ on: Bool) {
        guard on else { endBridge(); return }
        if bridgeTask == .invalid {
            bridgeTask = UIApplication.shared.beginBackgroundTask(withName: "ytlite-next-video") { [weak self] in
                self?.endBridge()
            }
        }
        for delay in [1.0, 2.5, 4.0, 6.0, 9.0, 13.0] {
            DispatchQueue.main.asyncAfter(deadline: .now() + delay) { [weak self] in
                guard let self, self.bridgeTask != .invalid else { return }
                self.webView.evaluateJavaScript(
                    "window.ytLite && window.ytLite.kick && window.ytLite.kick()",
                    completionHandler: nil
                )
            }
        }
        // 長くても20秒で終わりにする
        DispatchQueue.main.asyncAfter(deadline: .now() + 20) { [weak self] in
            self?.endBridge()
        }
    }

    private func endBridge() {
        guard bridgeTask != .invalid else { return }
        UIApplication.shared.endBackgroundTask(bridgeTask)
        bridgeTask = .invalid
    }

    // MARK: - タブ

    private func tab(for url: URL?) -> Tab? {
        guard let url, (url.host ?? "").hasSuffix("youtube.com") else { return nil }
        let path = url.path
        if path.isEmpty || path == "/" { return .home }
        if path.hasPrefix("/shorts") { return .shorts }
        if path.hasPrefix("/feed/subscriptions") { return .subs }
        if path.hasPrefix("/feed/library") || path.hasPrefix("/feed/you") ||
            path.hasPrefix("/feed/history") || path.hasPrefix("/playlist") { return .you }
        return nil   // 動画ページや検索結果などは、選択中のタブをそのままにする
    }

    private func syncTab(with url: URL?) {
        guard let tab = tab(for: url),
              let item = tabBar.items?.first(where: { $0.tag == tab.rawValue }) else { return }
        currentTab = tab
        tabBar.selectedItem = item
    }

    private func goTab(_ tab: Tab) {
        let onYouTube = (webView.url?.host ?? "").hasSuffix("youtube.com")
        if onYouTube {
            webView.evaluateJavaScript(
                "window.ytLite && window.ytLite.goTab ? window.ytLite.goTab('\(tab.jsName)') : (location.href = '\(tab.path)')",
                completionHandler: nil
            )
        } else if let url = URL(string: "https://m.youtube.com" + tab.path) {
            webView.load(URLRequest(url: url))
        }
    }

    private func updateProgress(_ progress: Float) {
        if landActive { progressView.isHidden = true; return }
        if progress >= 1.0 {
            progressView.setProgress(1.0, animated: true)
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.3) { [weak self] in
                self?.progressView.isHidden = true
                self?.progressView.setProgress(0, animated: false)
            }
        } else {
            progressView.isHidden = false
            progressView.setProgress(progress, animated: progress > progressView.progress)
        }
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

// MARK: - タブバー

extension ViewController: UITabBarDelegate {
    func tabBar(_ tabBar: UITabBar, didSelect item: UITabBarItem) {
        guard let tab = Tab(rawValue: item.tag) else { return }
        UISelectionFeedbackGenerator().selectionChanged()
        // 今いるタブのトップでもう一度押した → 一番上までスクロール
        if tab == currentTab && self.tab(for: webView.url) == tab {
            webView.evaluateJavaScript(
                "window.ytLite && window.ytLite.scrollTop ? window.ytLite.scrollTop() : window.scrollTo(0, 0)",
                completionHandler: nil
            )
            return
        }
        currentTab = tab
        goTab(tab)
    }
}

// MARK: - スクリプトからの連絡

extension ViewController: WKScriptMessageHandler {
    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        guard let body = message.body as? [String: Any] else { return }
        if let land = body["land"] as? Bool {
            setLand(land)
        }
        if let bridge = body["bridge"] as? Bool {
            setBridge(bridge)
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
