import UIKit
import Capacitor

@UIApplicationMain
class AppDelegate: UIResponder, UIApplicationDelegate {

    var window: UIWindow?
    private var pendingShortcutURL: URL?

    func application(_ application: UIApplication, didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]?) -> Bool {
        if let shortcutItem = launchOptions?[.shortcutItem] as? UIApplicationShortcutItem,
           let url = urlForShortcut(shortcutItem.type) {
            pendingShortcutURL = url
            // Returning false prevents UIKit from delivering the same quick action again through
            // performActionFor after launch. We forward it once the Capacitor view is active.
            return false
        }
        return true
    }

    func applicationWillResignActive(_ application: UIApplication) {
        // Sent when the application is about to move from active to inactive state.
    }

    func applicationDidEnterBackground(_ application: UIApplication) {
        // Release shared resources here if native-only state is introduced later.
    }

    func applicationWillEnterForeground(_ application: UIApplication) {
        // Capacitor/App handles the corresponding foreground event for the web core.
    }

    func applicationDidBecomeActive(_ application: UIApplication) {
        guard let url = pendingShortcutURL else { return }
        pendingShortcutURL = nil

        // A cold launch reaches this point after the main native view has become active. Deferring
        // one main-loop turn prevents the quick-action URL from racing the Capacitor bridge setup.
        DispatchQueue.main.async { [weak self] in
            guard self != nil else { return }
            _ = ApplicationDelegateProxy.shared.application(application, open: url, options: [:])
        }
    }

    func applicationWillTerminate(_ application: UIApplication) {
        // No native-only financial state is persisted here.
    }

    func application(_ app: UIApplication, open url: URL, options: [UIApplication.OpenURLOptionsKey: Any] = [:]) -> Bool {
        return ApplicationDelegateProxy.shared.application(app, open: url, options: options)
    }

    func application(_ application: UIApplication, continue userActivity: NSUserActivity, restorationHandler: @escaping ([UIUserActivityRestoring]?) -> Void) -> Bool {
        return ApplicationDelegateProxy.shared.application(application, continue: userActivity, restorationHandler: restorationHandler)
    }

    func application(
        _ application: UIApplication,
        performActionFor shortcutItem: UIApplicationShortcutItem,
        completionHandler: @escaping (Bool) -> Void
    ) {
        guard let url = urlForShortcut(shortcutItem.type) else {
            completionHandler(false)
            return
        }

        let handled = ApplicationDelegateProxy.shared.application(application, open: url, options: [:])
        completionHandler(handled)
    }

    private func urlForShortcut(_ type: String) -> URL? {
        switch type {
        case "br.com.mfinanceiro.app.quick":
            return URL(string: "mfinanceiro://quick")
        case "br.com.mfinanceiro.app.scan":
            return URL(string: "mfinanceiro://scan")
        case "br.com.mfinanceiro.app.pulse":
            return URL(string: "mfinanceiro://pulse")
        default:
            return nil
        }
    }
}
