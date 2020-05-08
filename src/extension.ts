import * as vscode from 'vscode';
import { FeedList, Feed } from './feeds';
import { ArticleList, Article } from './articles';
import { Fetcher } from './fetcher';
import { Summary, Content, Entry, Abstract } from './content';

export async function activate(context: vscode.ExtensionContext) {
    const fetcher = new Fetcher(context);

    const feed_list = new FeedList(fetcher);
    await feed_list.fetch(false);
    vscode.window.registerTreeDataProvider('rss-feeds', feed_list);
    const article_list = new ArticleList();
    vscode.window.registerTreeDataProvider('rss-articles', article_list);

    let current_feed: string | undefined;
    let updating: boolean = false;

    let disposable = vscode.commands.registerCommand('rss.articles', (feed: string) => {
        current_feed = feed;
        article_list.setArticles(feed_list.getContent(feed).abstracts);
    });
    context.subscriptions.push(disposable);

    disposable = vscode.commands.registerCommand('rss.refresh', async (auto: boolean) => {
        if (updating) {
            return;
        }
        updating = true;
        await vscode.window.withProgress({
            location: auto ? vscode.ProgressLocation.Window: vscode.ProgressLocation.Notification,
            title: "Updating RSS...",
            cancellable: false
        }, async () => {
            await feed_list.fetch(true);
            feed_list.refresh();
            if (current_feed) {
                article_list.setArticles(feed_list.contents[current_feed].abstracts);
            }
            updating = false;
        });
    });
    context.subscriptions.push(disposable);

    disposable = vscode.commands.registerCommand('rss.open-website', async (feed: Feed) => {
        vscode.env.openExternal(vscode.Uri.parse(feed_list.getContent(feed.feed).link));
    });
    context.subscriptions.push(disposable);

    disposable = vscode.commands.registerCommand('rss.refresh-one', async (feed?: Feed) => {
        if (updating) {
            return;
        }
        updating = true;
        let url: string;
        if (feed) {
            url = feed.feed;
        } else if (current_feed) {
            url = current_feed;
        } else{
            return;
        }
        await vscode.window.withProgress({
            location: vscode.ProgressLocation.Notification,
            title: "Updating RSS...",
            cancellable: false
        }, async () => {
            await feed_list.fetch_one(url, true);
            feed_list.refresh();
            if (current_feed) {
                article_list.setArticles(feed_list.contents[current_feed].abstracts);
            }
            updating = false;
        });
    });
    context.subscriptions.push(disposable);

    disposable = vscode.commands.registerCommand('rss.read', (abstract: Abstract) => {
        const entry: Entry | undefined = context.globalState.get(abstract.link);
        if (entry === undefined) {return;}
        const panel = vscode.window.createWebviewPanel(
            'rss', entry.title, vscode.ViewColumn.One, {retainContextWhenHidden: true});
        const css = '<style type="text/css">body{font-size:1em;max-width:960px;margin:auto;}</style>';
        panel.webview.html = css + entry.content;
        abstract.read = true;
        entry.read = true;
        article_list.refresh();
        feed_list.refresh();
        context.globalState.update(entry.link, entry);
    });
    context.subscriptions.push(disposable);

    disposable = vscode.commands.registerCommand('rss.open-link', (article: Article) => {
        vscode.env.openExternal(vscode.Uri.parse(article.abstract.link));
    });
    context.subscriptions.push(disposable);

    disposable = vscode.commands.registerCommand('rss.set-read', (article: Article) => {
        const entry: Entry | undefined = context.globalState.get(article.abstract.link);
        if (entry === undefined) {return;}
        article.abstract.read = true;
        entry.read = true;
        feed_list.refresh();
        article_list.refresh();
        context.globalState.update(entry.link, entry);
    });
    context.subscriptions.push(disposable);

    disposable = vscode.commands.registerCommand('rss.set-unread', (article: Article) => {
        const entry: Entry | undefined = context.globalState.get(article.abstract.link);
        if (entry === undefined) {return;}
        article.abstract.read = false;
        entry.read = false;
        feed_list.refresh();
        article_list.refresh();
        context.globalState.update(entry.link, entry);
    });
    context.subscriptions.push(disposable);

    disposable = vscode.commands.registerCommand('rss.set-all-read', async (feed: Feed) => {
        await vscode.window.withProgress({
            location: vscode.ProgressLocation.Notification,
            title: "Wait a moment...",
            cancellable: false
        }, async () => {
            const abstracts = feed_list.getContent(feed.feed).abstracts;
            for (const abstract of abstracts) {
                abstract.read = true;
                const entry: Entry | undefined = context.globalState.get(abstract.link);
                if (entry) {
                    entry.read = true;
                    await context.globalState.update(entry.link, entry);
                }
            }
            feed_list.refresh();
            if (feed.feed === current_feed) {
                article_list.setArticles(abstracts);
            }
        });
    });
    context.subscriptions.push(disposable);

    disposable = vscode.commands.registerCommand('rss.add-feed', async () => {
        let url: string | undefined = await vscode.window.showInputBox({prompt: 'Enter the feed URL'});
        if (url === undefined || url.length <= 0) {return;}
        const cfg = vscode.workspace.getConfiguration('rss');
        cfg.feeds.push(url);
        await cfg.update('feeds', cfg.feeds, true);
    });
    context.subscriptions.push(disposable);

    disposable = vscode.commands.registerCommand('rss.remove-feed', async (feed: Feed) => {
        const cfg = vscode.workspace.getConfiguration('rss');
        await cfg.update('feeds', cfg.feeds.filter((e: string) => e !== feed.feed), true);
        const summary: Summary | undefined = context.globalState.get(feed.feed);
        for (const link of summary?.catelog || []) {
            await context.globalState.update(link, undefined);
        }
        await context.globalState.update(feed.feed, undefined);
    });
    context.subscriptions.push(disposable);

    const do_refresh = () => vscode.commands.executeCommand('rss.refresh', true);
    const cfg = vscode.workspace.getConfiguration('rss');
    let timer = setInterval(do_refresh, cfg.interval * 1000);

    disposable = vscode.workspace.onDidChangeConfiguration(async (e) => {
        clearInterval(timer);
        const cfg = vscode.workspace.getConfiguration('rss');
        timer = setInterval(do_refresh, cfg.interval * 1000);
        await vscode.window.withProgress({
            location: vscode.ProgressLocation.Notification,
            title: "Updating RSS...",
            cancellable: false
        }, async () => {
            await feed_list.fetch(false);
            feed_list.refresh();
        });
    });
    context.subscriptions.push(disposable);
}
