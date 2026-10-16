import UIKit
import WebKit

// 画面構成
//  ・browseView … 一覧・検索・チャンネルなどを表示する画面（タブバーで切り替え）
//  ・playerView … 動画を再生する専用の画面。展開 / ミニ / 横全画面 を切り替える
// 2つに分けることで、動画を再生したまま一覧や検索を使える（ミニプレーヤー）。
final class ViewController: UIViewController {

    // MARK: - 種類

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

    // 再生画面の状態
    private enum PlayerState {
        case hidden     // 何も再生していない
        case expanded   // 大きく表示
        case mini       // 画面下に小さく畳んだ状態（再生は続く）
        case land       // 横全画面
    }

    // MARK: - 部品

    private var browseView: WKWebView!
    private var playerView: WKWebView!

    private let playerContainer = UIView()
    private let grabber = UIView()                       // 展開時の上のバー（﹀）
    private let miniTitle = UILabel()
    private let miniPlayButton = UIButton(type: .system)
    private let miniPiPButton = UIButton(type: .system)
    private let miniCloseButton = UIButton(type: .system)
    private var miniTap: UITapGestureRecognizer!
    private var miniSwipeUp: UISwipeGestureRecognizer!

    private let tabBar = UITabBar()
    private let progressView = UIProgressView(progressViewStyle: .bar)

    private var state: PlayerState = .hidden
    private var currentTab: Tab = .home
    private var observations: [NSKeyValueObservation] = []
    private var miniTimer: Timer?
    private var lastOpenedVideo: (url: String, time: Date)?
    private let homeURL = URL(string: "https://m.youtube.com/")!

    // YouTubeのテーマ（一覧画面の背景から判定）。nil = まだ分からない
    private var themeDark: Bool?
    private var pageBackground: UIColor?

    private let miniHeight: CGFloat = 64
    private let grabberHeight: CGFloat = 30

    // MARK: - 画面の向き・表示

    override var supportedInterfaceOrientations: UIInterfaceOrientationMask { .portrait }
    override var preferredInterfaceOrientationForPresentation: UIInterfaceOrientation { .portrait }
    override var prefersStatusBarHidden: Bool { state == .land }
    override var preferredStatusBarStyle: UIStatusBarStyle {
        guard let dark = themeDark else { return .default }
        return dark ? .lightContent : .darkContent
    }
    override var prefersHomeIndicatorAutoHidden: Bool { state == .land }
    override var preferredScreenEdgesDeferringSystemGestures: UIRectEdge { state == .land ? .all : [] }

    // MARK: - 起動

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = .systemBackground

        // 一覧用の画面
        browseView = makeWebView(role: "browse")
        browseView.allowsBackForwardNavigationGestures = true
        let refresh = UIRefreshControl()
        refresh.addTarget(self, action: #selector(pullToRefresh(_:)), for: .valueChanged)
        browseView.scrollView.refreshControl = refresh
        view.addSubview(browseView)

        // 読み込みの進行バー
        progressView.trackTintColor = .clear
        progressView.progressTintColor = .systemRed
        progressView.isHidden = true
        view.addSubview(progressView)

        // タブバー
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

        setupPlayer()
        setupObservers()

        // 広告サーバーへの通信を止めるルールを、両方の画面に入れてから読み込む
        WKContentRuleListStore.default().compileContentRuleList(
            forIdentifier: "ytlite-block",
            encodedContentRuleList: Self.blockRules
        ) { [weak self] list, _ in
            DispatchQueue.main.async {
                guard let self else { return }
                if let list {
                    self.browseView.configuration.userContentController.add(list)
                    self.playerView.configuration.userContentController.add(list)
                }
                self.browseView.load(URLRequest(url: self.homeURL))
            }
        }
    }

    private func makeWebView(role: String) -> WKWebView {
        let config = WKWebViewConfiguration()
        config.allowsInlineMediaPlayback = true
        config.allowsPictureInPictureMediaPlayback = true
        config.mediaTypesRequiringUserActionForPlayback = []
        config.applicationNameForUserAgent = "Version/18.0 Mobile/15E148 Safari/604.1"
        if #available(iOS 15.4, *) {
            config.preferences.isElementFullscreenEnabled = true
        }

        let content = WKUserContentController()
        // アプリ版であることと、この画面の役割を先に伝える
        content.addUserScript(WKUserScript(
            source: "window.__YTLITE_APP__ = true; window.__YTLITE_ROLE__ = '\(role)';",
            injectionTime: .atDocumentStart,
            forMainFrameOnly: true,
            in: .page
        ))
        if let url = Bundle.main.url(forResource: "yt-lite.user", withExtension: "js"),
           let source = try? String(contentsOf: url, encoding: .utf8) {
            content.addUserScript(WKUserScript(
                source: source,
                injectionTime: .atDocumentStart,
                forMainFrameOnly: true,
                in: .page
            ))
        }
        content.add(WeakScriptMessageHandler(self), contentWorld: .page, name: "ytLite")
        config.userContentController = content

        let webView = WKWebView(frame: .zero, configuration: config)
        webView.navigationDelegate = self
        webView.uiDelegate = self
        webView.isOpaque = false
        webView.backgroundColor = .systemBackground
        webView.scrollView.contentInsetAdjustmentBehavior = .never
        return webView
    }

    private func setupPlayer() {
        playerContainer.backgroundColor = .systemBackground
        playerContainer.clipsToBounds = true
        playerContainer.isHidden = true
        view.addSubview(playerContainer)   // 一覧とタブバーより上に重ねる

        playerView = makeWebView(role: "player")
        playerView.allowsBackForwardNavigationGestures = false
        playerView.clipsToBounds = true
        playerContainer.addSubview(playerView)

        // 展開時の上のバー：タップか下スワイプで小さく畳む
        grabber.backgroundColor = .systemBackground
        let chevron = UIImageView(image: UIImage(systemName: "chevron.down"))
        chevron.tintColor = .label
        chevron.contentMode = .scaleAspectFit
        chevron.frame = CGRect(x: 12, y: 3, width: 24, height: 24)
        grabber.addSubview(chevron)
        let handle = UIView(frame: CGRect(x: 0, y: 6, width: 36, height: 5))
        handle.backgroundColor = .tertiaryLabel
        handle.layer.cornerRadius = 2.5
        handle.tag = 100
        grabber.addSubview(handle)
        grabber.addGestureRecognizer(UITapGestureRecognizer(target: self, action: #selector(minimizePlayer)))
        grabber.addGestureRecognizer(UIPanGestureRecognizer(target: self, action: #selector(grabberPanned(_:))))
        playerContainer.addSubview(grabber)

        // ミニプレーヤーの部品
        miniTitle.font = .systemFont(ofSize: 14, weight: .semibold)
        miniTitle.textColor = .label
        miniTitle.numberOfLines = 2
        playerContainer.addSubview(miniTitle)

        miniPlayButton.tintColor = .label
        miniPlayButton.setImage(UIImage(systemName: "pause.fill"), for: .normal)
        miniPlayButton.addTarget(self, action: #selector(miniPlayTapped), for: .touchUpInside)
        playerContainer.addSubview(miniPlayButton)

        // ミニプレーヤーのPiPボタン：一覧や検索を見ながら小窓で再生
        miniPiPButton.tintColor = .label
        miniPiPButton.setImage(UIImage(systemName: "pip.enter"), for: .normal)
        miniPiPButton.addTarget(self, action: #selector(miniPiPTapped), for: .touchUpInside)
        playerContainer.addSubview(miniPiPButton)

        miniCloseButton.tintColor = .label
        miniCloseButton.setImage(UIImage(systemName: "xmark"), for: .normal)
        miniCloseButton.addTarget(self, action: #selector(closePlayer), for: .touchUpInside)
        playerContainer.addSubview(miniCloseButton)

        // ミニプレーヤーをタップしたら展開、上スワイプでも展開
        miniTap = UITapGestureRecognizer(target: self, action: #selector(expandPlayer))
        playerContainer.addGestureRecognizer(miniTap)
        miniSwipeUp = UISwipeGestureRecognizer(target: self, action: #selector(miniSwipedUp(_:)))
        miniSwipeUp.direction = .up
        playerContainer.addGestureRecognizer(miniSwipeUp)

        updateChrome()
    }

    private func setupObservers() {
        // 一覧画面のページが変わったとき：タブ選択を合わせる／動画ページなら再生画面へ回す
        observations.append(browseView.observe(\.url, options: [.new]) { [weak self] webView, _ in
            let url = webView.url
            DispatchQueue.main.async { self?.browseURLChanged(url) }
        })
        observations.append(browseView.observe(\.estimatedProgress, options: [.new]) { [weak self] webView, _ in
            let progress = Float(webView.estimatedProgress)
            DispatchQueue.main.async { self?.updateProgress(progress) }
        })
        // 再生画面が動画以外のページに移ったら、それは一覧画面で開く
        observations.append(playerView.observe(\.url, options: [.new]) { [weak self] webView, _ in
            let url = webView.url
            DispatchQueue.main.async { self?.playerURLChanged(url) }
        })

        UIDevice.current.beginGeneratingDeviceOrientationNotifications()
        let center = NotificationCenter.default
        center.addObserver(self, selector: #selector(deviceOrientationChanged),
                           name: UIDevice.orientationDidChangeNotification, object: nil)
        center.addObserver(self, selector: #selector(appWillResignActive),
                           name: UIApplication.willResignActiveNotification, object: nil)
        center.addObserver(self, selector: #selector(appDidBecomeActive),
                           name: UIApplication.didBecomeActiveNotification, object: nil)
    }

    // MARK: - レイアウト

    override func viewDidLayoutSubviews() {
        super.viewDidLayoutSubviews()
        layoutViews()
    }

    private func layoutViews() {
        let b = view.bounds
        let safe = view.safeAreaInsets
        let tabHeight = 49 + safe.bottom

        tabBar.frame = CGRect(x: 0, y: b.height - tabHeight, width: b.width, height: tabHeight)
        let browseBottom = b.height - tabHeight - (state == .mini ? miniHeight : 0)
        browseView.frame = CGRect(x: 0, y: safe.top, width: b.width, height: max(0, browseBottom - safe.top))
        progressView.frame = CGRect(x: 0, y: safe.top, width: b.width, height: 2)

        // 再生画面の「本来の大きさ」（展開時の大きさ）
        let fullWidth = b.width
        let fullHeight = max(1, b.height - safe.top - grabberHeight - safe.bottom)

        // ミニ以外では縮小と切り抜きを解除してから大きさを決める
        if state != .mini {
            playerView.transform = .identity
            playerView.mask = nil
        }

        switch state {
        case .hidden:
            playerContainer.frame = CGRect(x: 0, y: b.height, width: b.width, height: b.height - safe.top)
            playerView.frame = CGRect(x: 0, y: grabberHeight, width: b.width,
                                      height: b.height - safe.top - grabberHeight - safe.bottom)
        case .expanded:
            playerContainer.frame = CGRect(x: 0, y: safe.top, width: b.width, height: b.height - safe.top)
            grabber.frame = CGRect(x: 0, y: 0, width: b.width, height: grabberHeight)
            grabber.viewWithTag(100)?.center = CGPoint(x: b.width / 2, y: 9)
            playerView.frame = CGRect(x: 0, y: grabberHeight, width: b.width,
                                      height: b.height - safe.top - grabberHeight - safe.bottom)
        case .mini:
            playerContainer.frame = CGRect(x: 0, y: b.height - tabHeight - miniHeight,
                                           width: b.width, height: miniHeight)
            // 再生画面の大きさは変えずに（ページの組み直しで真っ白になるのを防ぐ）、
            // 見た目だけ縮小して、上の動画部分(16:9)だけを切り抜いて見せる
            let thumbWidth: CGFloat = 96
            let thumbHeight = thumbWidth * 9 / 16
            let scale = thumbWidth / fullWidth
            playerView.bounds = CGRect(x: 0, y: 0, width: fullWidth, height: fullHeight)
            playerView.transform = CGAffineTransform(scaleX: scale, y: scale)
            playerView.center = CGPoint(x: 8 + fullWidth * scale / 2,
                                        y: (miniHeight - thumbHeight) / 2 + fullHeight * scale / 2)
            let mask = UIView(frame: CGRect(x: 0, y: 0, width: fullWidth, height: fullWidth * 9 / 16))
            mask.backgroundColor = .black
            mask.layer.cornerRadius = 6 / scale
            playerView.mask = mask
            miniCloseButton.frame = CGRect(x: b.width - 48, y: (miniHeight - 44) / 2, width: 44, height: 44)
            miniPlayButton.frame = CGRect(x: b.width - 92, y: (miniHeight - 44) / 2, width: 44, height: 44)
            miniPiPButton.frame = CGRect(x: b.width - 136, y: (miniHeight - 44) / 2, width: 44, height: 44)
            let titleX = 8 + thumbWidth + 10
            miniTitle.frame = CGRect(x: titleX, y: 6, width: max(0, b.width - titleX - 140), height: miniHeight - 12)
        case .land:
            playerContainer.frame = b
            playerView.frame = CGRect(origin: .zero, size: b.size)
        }
    }

    // 状態に合わせて、部品の表示・非表示などを切り替える
    private func updateChrome() {
        let isMini = state == .mini
        grabber.isHidden = state != .expanded
        miniTitle.isHidden = !isMini
        miniPlayButton.isHidden = !isMini
        miniPiPButton.isHidden = !isMini
        miniCloseButton.isHidden = !isMini
        miniTap.isEnabled = isMini
        miniSwipeUp.isEnabled = isMini   // 大きく表示中は、動画ページのスクロールを邪魔しない
        playerView.isUserInteractionEnabled = !isMini   // ミニのときは全体で1つのボタン
        playerContainer.backgroundColor = state == .land ? .black : (isMini ? miniBackground() : (pageBackground ?? .systemBackground))
        tabBar.isHidden = state == .expanded || state == .land
        if state == .land { progressView.isHidden = true }
    }

    private func setState(_ newState: PlayerState, animated: Bool = true) {
        guard newState != state else { return }
        let oldState = state
        state = newState

        // スクリプトにミニ表示かどうかを伝える（動画だけを画面いっぱいにする）
        playerView.evaluateJavaScript(
            "window.ytLite && window.ytLite.setMini && window.ytLite.setMini(\(newState == .mini))",
            completionHandler: nil
        )
        if newState == .mini { startMiniUpdates() } else { stopMiniUpdates() }

        if newState != .hidden { playerContainer.isHidden = false }
        updateChrome()
        setNeedsStatusBarAppearanceUpdate()
        setNeedsUpdateOfHomeIndicatorAutoHidden()
        setNeedsUpdateOfScreenEdgesDeferringSystemGestures()

        let duration = (animated && oldState != .land && newState != .land) ? 0.28 : 0
        UIView.animate(withDuration: duration, delay: 0, options: [.curveEaseInOut]) {
            self.layoutViews()
        } completion: { _ in
            if self.state == .hidden { self.playerContainer.isHidden = true }
        }
    }

    // MARK: - 再生画面の操作

    private func openVideo(_ url: URL) {
        // 同じ動画を短い間に何度も開かないように（クリックとページ移動の両方で届くことがある）
        if let last = lastOpenedVideo, last.url == url.absoluteString, Date().timeIntervalSince(last.time) < 1.5 {
            return
        }
        lastOpenedVideo = (url.absoluteString, Date())
        // 一覧側で鳴っている動画は止める
        browseView.evaluateJavaScript("document.querySelectorAll('video').forEach(function(v){v.pause()})",
                                      completionHandler: nil)
        playerView.load(URLRequest(url: url))
        setState(.expanded)
    }

    private func openInBrowse(_ url: URL) {
        browseView.load(URLRequest(url: url))
        if state == .expanded || state == .land { setState(.mini) }
    }

    @objc private func minimizePlayer() {
        if state == .expanded { setState(.mini) }
    }

    @objc private func expandPlayer() {
        if state == .mini { setState(.expanded) }
    }

    @objc private func miniSwipedUp(_ gesture: UISwipeGestureRecognizer) {
        expandPlayer()
    }

    @objc private func grabberPanned(_ gesture: UIPanGestureRecognizer) {
        guard state == .expanded else { return }
        let dy = max(0, gesture.translation(in: view).y)
        switch gesture.state {
        case .changed:
            playerContainer.transform = CGAffineTransform(translationX: 0, y: dy)
        case .ended, .cancelled:
            let fast = gesture.velocity(in: view).y > 600
            if dy > 120 || fast {
                playerContainer.transform = .identity
                setState(.mini)
            } else {
                UIView.animate(withDuration: 0.2) { self.playerContainer.transform = .identity }
            }
        default:
            break
        }
    }

    @objc private func miniPlayTapped() {
        playerView.evaluateJavaScript(
            "window.ytLite && window.ytLite.togglePlay && window.ytLite.togglePlay()"
        ) { [weak self] _, _ in
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.3) { self?.updateMiniInfo() }
        }
    }

    @objc private func miniPiPTapped() {
        playerView.evaluateJavaScript("window.ytLite && window.ytLite.pip && window.ytLite.pip()") { [weak self] _, _ in
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.6) { self?.updateMiniInfo() }
        }
    }

    @objc private func closePlayer() {
        playerView.evaluateJavaScript("window.ytLite && window.ytLite.pause && window.ytLite.pause()",
                                      completionHandler: nil)
        setState(.hidden)
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.35) { [weak self] in
            guard let self, self.state == .hidden else { return }
            self.playerView.load(URLRequest(url: URL(string: "about:blank")!))
            self.lastOpenedVideo = nil
        }
    }

    private func startMiniUpdates() {
        miniTimer?.invalidate()
        updateMiniInfo()
        miniTimer = Timer.scheduledTimer(withTimeInterval: 1.0, repeats: true) { [weak self] _ in
            DispatchQueue.main.async { self?.updateMiniInfo() }
        }
    }

    private func stopMiniUpdates() {
        miniTimer?.invalidate()
        miniTimer = nil
    }

    private func updateMiniInfo() {
        playerView.evaluateJavaScript("window.ytLite && window.ytLite.info ? window.ytLite.info() : null") { [weak self] result, _ in
            guard let self, let info = result as? [String: Any] else { return }
            self.miniTitle.text = info["title"] as? String
            let paused = (info["paused"] as? Bool) ?? true
            self.miniPlayButton.setImage(UIImage(systemName: paused ? "play.fill" : "pause.fill"), for: .normal)
            let inPiP = (info["pip"] as? Bool) ?? false
            self.miniPiPButton.setImage(UIImage(systemName: inPiP ? "pip.exit" : "pip.enter"), for: .normal)
        }
    }

    // MARK: - テーマ（YouTubeのダーク／ライトに合わせる）

    private func applyTheme(dark: Bool, background: UIColor?) {
        themeDark = dark
        pageBackground = background
        let style: UIUserInterfaceStyle = dark ? .dark : .light
        // アプリ側の部品だけテーマを固定する（YouTubeのページ自体には手を加えない）
        for v in [tabBar, grabber, miniTitle, miniPlayButton, miniPiPButton, miniCloseButton, progressView] as [UIView] {
            v.overrideUserInterfaceStyle = style
        }
        let base = background ?? (dark ? .black : .white)
        view.backgroundColor = base
        grabber.backgroundColor = base
        browseView.backgroundColor = base
        playerView.backgroundColor = base

        let appearance = UITabBarAppearance()
        appearance.configureWithOpaqueBackground()
        appearance.backgroundColor = base
        appearance.shadowColor = dark ? UIColor(white: 1, alpha: 0.08) : UIColor(white: 0, alpha: 0.1)
        tabBar.standardAppearance = appearance
        tabBar.scrollEdgeAppearance = appearance

        updateChrome()
        setNeedsStatusBarAppearanceUpdate()
    }

    // ミニプレーヤーの背景：ページの背景より少しだけ明るく（ライトなら少し暗く）
    private func miniBackground() -> UIColor {
        guard let dark = themeDark else { return .secondarySystemBackground }
        return dark ? UIColor(white: 0.14, alpha: 1) : UIColor(white: 0.95, alpha: 1)
    }

    private static func color(fromRGB text: String) -> UIColor? {
        let parts = text.split(separator: ",").compactMap { Double($0.trimmingCharacters(in: .whitespaces)) }
        guard parts.count == 3 else { return nil }
        return UIColor(red: parts[0] / 255, green: parts[1] / 255, blue: parts[2] / 255, alpha: 1)
    }

    // MARK: - ページ移動の振り分け

    private func isYouTube(_ url: URL) -> Bool {
        (url.host ?? "").hasSuffix("youtube.com")
    }

    private func isVideoPage(_ url: URL) -> Bool {
        url.path == "/watch" || url.path.hasPrefix("/live/")
    }

    private func browseURLChanged(_ url: URL?) {
        syncTab(with: url)
        // 一覧画面が（ページ内移動で）動画ページになったら、再生画面で開き直して一覧は戻す
        guard let url, isYouTube(url), isVideoPage(url) else { return }
        openVideo(url)
        if browseView.canGoBack {
            browseView.goBack()
        } else {
            browseView.load(URLRequest(url: homeURL))
        }
    }

    private func playerURLChanged(_ url: URL?) {
        guard let url, isYouTube(url), state != .hidden, !isVideoPage(url) else { return }
        // 再生画面でチャンネルなどに移った → 一覧画面で開き、再生画面は動画に戻す
        openInBrowse(url)
        if playerView.canGoBack { playerView.goBack() }
    }

    // MARK: - タブ

    private func tab(for url: URL?) -> Tab? {
        guard let url, isYouTube(url) else { return nil }
        let path = url.path
        if path.isEmpty || path == "/" { return .home }
        if path.hasPrefix("/shorts") { return .shorts }
        if path.hasPrefix("/feed/subscriptions") { return .subs }
        if path.hasPrefix("/feed/library") || path.hasPrefix("/feed/you") ||
            path.hasPrefix("/feed/history") || path.hasPrefix("/playlist") { return .you }
        return nil
    }

    private func syncTab(with url: URL?) {
        guard let tab = tab(for: url),
              let item = tabBar.items?.first(where: { $0.tag == tab.rawValue }) else { return }
        currentTab = tab
        tabBar.selectedItem = item
    }

    private func goTab(_ tab: Tab) {
        if let url = browseView.url, isYouTube(url) {
            browseView.evaluateJavaScript(
                "window.ytLite && window.ytLite.goTab ? window.ytLite.goTab('\(tab.jsName)') : (location.href = '\(tab.path)')",
                completionHandler: nil
            )
        } else if let url = URL(string: "https://m.youtube.com" + tab.path) {
            browseView.load(URLRequest(url: url))
        }
    }

    private func updateProgress(_ progress: Float) {
        if state == .land { progressView.isHidden = true; return }
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
        browseView.reload()
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.8) { sender.endRefreshing() }
    }

    // MARK: - 向き・自動PiP

    @objc private func deviceOrientationChanged() {
        // 再生画面を大きく出しているときだけ、横にしたら横全画面
        guard state == .expanded || state == .land else { return }
        let dir: Int
        switch UIDevice.current.orientation {
        case .landscapeLeft:  dir = 1
        case .landscapeRight: dir = -1
        case .portrait:       dir = 0
        default: return
        }
        playerView.evaluateJavaScript("window.ytLite && window.ytLite.autoLand(\(dir))", completionHandler: nil)
    }

    // ホームに戻り始めた瞬間：再生中ならPiPにする
    @objc private func appWillResignActive() {
        guard state != .hidden else { return }
        playerView.evaluateJavaScript("window.ytLite && window.ytLite.autoPiP && window.ytLite.autoPiP()",
                                      completionHandler: nil)
    }

    // アプリに戻ってきた：自動で開いたPiPは閉じる
    @objc private func appDidBecomeActive() {
        guard state != .hidden else { return }
        playerView.evaluateJavaScript("window.ytLite && window.ytLite.cancelAutoPiP && window.ytLite.cancelAutoPiP()",
                                      completionHandler: nil)
    }

    // MARK: - 裏で次の動画に切り替えるときの「つなぎ」

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
                self.playerView.evaluateJavaScript("window.ytLite && window.ytLite.kick && window.ytLite.kick()",
                                                   completionHandler: nil)
            }
        }
        DispatchQueue.main.asyncAfter(deadline: .now() + 20) { [weak self] in
            self?.endBridge()
        }
    }

    private func endBridge() {
        guard bridgeTask != .invalid else { return }
        UIApplication.shared.endBackgroundTask(bridgeTask)
        bridgeTask = .invalid
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
        if tab == currentTab && self.tab(for: browseView.url) == tab {
            browseView.evaluateJavaScript(
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
        let fromPlayer = message.webView === playerView

        if fromPlayer {
            if let land = body["land"] as? Bool {
                if land {
                    setState(.land)
                } else if state == .land {
                    setState(.expanded)
                }
            }
            if let bridge = body["bridge"] as? Bool {
                setBridge(bridge)
            }
            if let href = body["openBrowse"] as? String, let url = URL(string: href) {
                openInBrowse(url)
            }
            // 次の動画への切り替えでPiPが閉じた → アプリが前面にいるときだけ開き直せる
            // （ホーム画面や他のアプリの上にいるときは、iOSがPiPを新しく開かせてくれない）
            if body["rePiP"] as? Bool == true, UIApplication.shared.applicationState == .active {
                for delay in [0.3, 1.0, 2.0] {
                    DispatchQueue.main.asyncAfter(deadline: .now() + delay) { [weak self] in
                        self?.playerView.evaluateJavaScript(
                            "window.ytLite && window.ytLite.enterPiP && window.ytLite.enterPiP()",
                            completionHandler: nil
                        )
                    }
                }
            }
        } else {
            if let href = body["openVideo"] as? String, let url = URL(string: href) {
                openVideo(url)
            }
            if let theme = body["theme"] as? String {
                let bg = (body["bg"] as? String).flatMap { Self.color(fromRGB: $0) }
                applyTheme(dark: theme == "dark", background: bg)
            }
            if body["browsePlaying"] as? Bool == true, state != .hidden {
                playerView.evaluateJavaScript("window.ytLite && window.ytLite.pause && window.ytLite.pause()",
                                              completionHandler: nil)
            }
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
        guard let url = navigationAction.request.url else {
            decisionHandler(.allow)
            return
        }
        let scheme = url.scheme?.lowercased() ?? ""
        // youtube:// などアプリを開こうとするリンクは無視して、このアプリ内にとどまる
        guard ["http", "https", "about", "blob", "data"].contains(scheme) else {
            decisionHandler(.cancel)
            return
        }
        let isMainFrame = navigationAction.targetFrame?.isMainFrame ?? true
        if isMainFrame, isYouTube(url) {
            // 一覧画面で動画を開こうとした → 再生画面で開く
            if webView === browseView, isVideoPage(url) {
                decisionHandler(.cancel)
                openVideo(url)
                return
            }
            // 再生画面でリンクから動画以外へ → 一覧画面で開く
            if webView === playerView, !isVideoPage(url), navigationAction.navigationType == .linkActivated {
                decisionHandler(.cancel)
                openInBrowse(url)
                return
            }
        }
        decisionHandler(.allow)
    }

    // 新しいタブで開くリンクは、同じ画面で開く
    func webView(
        _ webView: WKWebView,
        createWebViewWith configuration: WKWebViewConfiguration,
        for navigationAction: WKNavigationAction,
        windowFeatures: WKWindowFeatures
    ) -> WKWebView? {
        if navigationAction.targetFrame == nil, let url = navigationAction.request.url {
            if webView === playerView {
                openInBrowse(url)
            } else {
                webView.load(URLRequest(url: url))
            }
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
