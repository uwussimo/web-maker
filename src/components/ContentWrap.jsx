import { h, Component } from 'preact';
import CodeEditor from './CodeEditor.jsx';
import { computeHtml, computeCss, computeJs } from '../computes';
import { modes, HtmlModes, CssModes, JsModes } from '../codeModes';
import {
	log,
	writeFile,
	getCompleteHtml,
	handleModeRequirements,
	sanitizeSplitSizes
} from '../utils';
import { SplitPane } from './SplitPane.jsx';
import { trackEvent } from '../analytics';
import { Console } from './Console';
import CssSettingsModal from './CssSettingsModal';
import { PreviewDimension } from './PreviewDimension.jsx';
import Modal from './Modal.jsx';
import { LocalStorageKeys } from '../constants.js';
const minCodeWrapSize = 33;

/* global htmlCodeEl
 */

export default class ContentWrap extends Component {
	constructor(props) {
		super(props);
		this.state = {
			isConsoleOpen:
				window.localStorage.getItem(LocalStorageKeys.WAS_CONSOLE_OPEN) ===
				'true',
			isCssSettingsModalOpen: false,
			isPreviewNotWorkingModalVisible: false,
			logs: []
		};

		this.updateTimer = null;
		this.htmlMode = HtmlModes.HTML;
		this.jsMode = HtmlModes.HTML;
		this.cssMode = CssModes.CSS;
		this.jsMode = JsModes.JS;
		this.prefs = {};
		this.codeInPreview = { html: null, css: null, js: null };
		this.cmCodes = { html: props.currentItem.html, css: '', js: '' };
		this.cm = {};

		window.onMessageFromConsole = this.onMessageFromConsole.bind(this);
		window.previewException = this.previewException.bind(this);
		// `clearConsole` is on window because it gets called from inside iframe also.
		window.clearConsole = this.clearConsole.bind(this);

		this.consoleHeaderDblClickHandler =
			this.consoleHeaderDblClickHandler.bind(this);
		this.clearConsoleBtnClickHandler =
			this.clearConsoleBtnClickHandler.bind(this);
		this.toggleConsole = this.toggleConsole.bind(this);
		this.evalConsoleExpr = this.evalConsoleExpr.bind(this);
		this.dismissPreviewNotWorkingModal =
			this.dismissPreviewNotWorkingModal.bind(this);
	}
	shouldComponentUpdate(nextProps, nextState) {
		return (
			this.state.isConsoleOpen !== nextState.isConsoleOpen ||
			this.state.isCssSettingsModalOpen !== nextState.isCssSettingsModalOpen ||
			this.state.isPreviewNotWorkingModalVisible !==
				nextState.isPreviewNotWorkingModalVisible ||
			this.state.logs !== nextState.logs ||
			this.state.codeSplitSizes !== nextState.codeSplitSizes ||
			this.state.mainSplitSizes !== nextState.mainSplitSizes ||
			this.props.currentLayoutMode !== nextProps.currentLayoutMode ||
			this.props.currentItem !== nextProps.currentItem ||
			this.props.prefs !== nextProps.prefs
		);
	}
	componentDidUpdate() {
		// log('🚀', 'didupdate', this.props.currentItem);
		// if (this.isValidItem(this.props.currentItem)) {
		// this.refreshEditor();
		// }
	}
	componentDidMount() {
		this.props.onRef(this);

		// Listen for logs from preview frame
		window.addEventListener('message', e => {
			if (e.data && e.data.logs) {
				this.onMessageFromConsole(...e.data.logs);
			}
		});
	}

	onHtmlCodeChange(editor, change) {
		this.cmCodes.html = editor.getValue();
		this.props.onCodeChange(
			'html',
			this.cmCodes.html,
			change.origin !== 'setValue'
		);
		this.onCodeChange(editor, change);
	}
	onCssCodeChange(editor, change) {
		this.cmCodes.css = editor.getValue();
		this.props.onCodeChange(
			'css',
			this.cmCodes.css,
			change.origin !== 'setValue'
		);
		this.onCodeChange(editor, change);
	}
	onJsCodeChange(editor, change) {
		this.cmCodes.js = editor.getValue();
		this.props.onCodeChange(
			'js',
			this.cmCodes.js,
			change.origin !== 'setValue'
		);
		this.onCodeChange(editor, change);
	}
	onCodeChange(editor, change) {
		clearTimeout(this.updateTimer);

		this.updateTimer = setTimeout(() => {
			// This is done so that multiple simultaneous setValue don't trigger too many preview refreshes
			// and in turn too many file writes on a single file (eg. preview.html).
			if (change.origin !== 'setValue') {
				this.setPreviewContent();

				// Track when people actually are working.
				trackEvent.previewCount = (trackEvent.previewCount || 0) + 1;
				if (trackEvent.previewCount === 4) {
					trackEvent('fn', 'usingPreview');
				}
			}
		}, this.props.prefs.previewDelay);
	}

	createPreviewFile(html, css, js) {
		const versionMatch = navigator.userAgent.match(/Chrome\/(\d+)/);

		const shouldInlineJs =
			!window.webkitRequestFileSystem ||
			!window.IS_EXTENSION ||
			(versionMatch && +versionMatch[1] >= 104);
		var contents = getCompleteHtml(
			html,
			css,
			shouldInlineJs ? js : null,
			this.props.currentItem
		);
		var blob = new Blob([contents], { type: 'text/plain;charset=UTF-8' });
		var blobjs = new Blob([js], { type: 'text/plain;charset=UTF-8' });

		// Track if people have written code.
		if (!trackEvent.hasTrackedCode && (html || css || js)) {
			trackEvent('fn', 'hasCode');
			trackEvent.hasTrackedCode = true;
		}

		if (shouldInlineJs) {
			if (this.detachedWindow) {
				log('✉️ Sending message to detached window');
				this.detachedWindow.postMessage({ contents }, '*');
			} else {
				const writeInsideIframe = () => {
					this.frame.contentDocument.open();
					this.frame.contentDocument.write(contents);
					this.frame.contentDocument.close();
				};
				Promise.race([
					// Just in case onload promise doesn't resolves
					new Promise(resolve => {
						setTimeout(resolve, 200);
					}),
					new Promise(resolve => {
						this.frame.onload = resolve;
					})
				]).then(writeInsideIframe);
				// Setting to blank string cause frame to reload
				this.frame.src = '';
			}
		} else {
			// we need to store user script in external JS file to prevent inline-script
			// CSP from affecting it.
			writeFile('script.js', blobjs, () => {
				writeFile('preview.html', blob, () => {
					var origin = chrome.i18n.getMessage()
						? `chrome-extension://${chrome.i18n.getMessage('@@extension_id')}`
						: `${location.origin}`;
					var src = `filesystem:${origin}/temporary/preview.html`;
					if (this.detachedWindow) {
						this.detachedWindow.postMessage({ url: src }, '*');
					} else {
						this.frame.src = src;
					}
				});
			});
		}
	}
	cleanupErrors(lang) {
		this.cm[lang].clearGutter('error-gutter');
	}

	showErrors(lang, errors) {
		this.cm[lang].showErrors(errors);
	}

	/**
	 * Generates the preview from the current code.
	 * @param {boolean} isForced Should refresh everything without any check or not
	 * @param {boolean} isManual Is this a manual preview request from user?
	 */
	setPreviewContent(isForced, isManual) {
		if (!isManual) {
			let autoPreview =
				window.forcedSettings.autoPreview !== undefined
					? window.forcedSettings.autoPreview
					: this.props.prefs.autoPreview;
			if (!autoPreview) {
				return;
			}
		}

		if (!this.props.prefs.preserveConsoleLogs) {
			this.clearConsole();
		}
		this.cleanupErrors('html');
		this.cleanupErrors('css');
		this.cleanupErrors('js');

		var currentCode = {
			html: this.cmCodes.html,
			css: this.cmCodes.css,
			js: this.cmCodes.js
		};
		log('🔎 setPreviewContent', isForced);
		const targetFrame = this.detachedWindow
			? this.detachedWindow.document.querySelector('iframe')
			: this.frame;

		const cssMode = this.props.currentItem.cssMode;
		// If just CSS was changed (and everything shudn't be empty),
		// change the styles inside the iframe.
		if (
			!isForced &&
			currentCode.html === this.codeInPreview.html &&
			currentCode.js === this.codeInPreview.js
		) {
			computeCss(
				cssMode === CssModes.ACSS ? currentCode.html : currentCode.css,
				cssMode,
				this.props.currentItem.cssSettings
			).then(result => {
				if (cssMode === CssModes.ACSS) {
					this.cm.css.setValue(result.code || '');
				}
				if (targetFrame.contentDocument.querySelector('#webmakerstyle')) {
					targetFrame.contentDocument.querySelector(
						'#webmakerstyle'
					).textContent = result.code || '';
				}
			});
		} else {
			var htmlPromise = computeHtml(
				currentCode.html,
				this.props.currentItem.htmlMode
			);
			var cssPromise = computeCss(
				cssMode === CssModes.ACSS ? currentCode.html : currentCode.css,
				cssMode,
				this.props.currentItem.cssSettings
			);
			var jsPromise = computeJs(
				currentCode.js,
				this.props.currentItem.jsMode,
				true,
				this.props.prefs.infiniteLoopTimeout
			);
			Promise.all([htmlPromise, cssPromise, jsPromise]).then(result => {
				if (cssMode === CssModes.ACSS) {
					this.cm.css.setValue(result[1].code || '');
				}

				this.createPreviewFile(
					result[0].code || '',
					result[1].code || '',
					result[2].code || ''
				);
				result.forEach(resultItem => {
					if (resultItem.errors) {
						this.showErrors(resultItem.errors.lang, resultItem.errors.data);
					}
				});

				const versionMatch = navigator.userAgent.match(/Chrome\/(\d+)/);
				if (
					result[2].code &&
					versionMatch &&
					+versionMatch[1] >= 104 &&
					window.IS_EXTENSION &&
					!window.sessionStorage.getItem('previewErrorMessageDismissed')
				) {
					this.setState({
						isPreviewNotWorkingModalVisible: true
					});
				}
			});
		}

		this.codeInPreview.html = currentCode.html;
		this.codeInPreview.css = currentCode.css;
		this.codeInPreview.js = currentCode.js;
	}
	isValidItem(item) {
		return !!item.title;
	}
	refreshEditor() {
		this.cmCodes.html = this.props.currentItem.html;
		this.cmCodes.css = this.props.currentItem.css;
		this.cmCodes.js = this.props.currentItem.js;
		this.cm.html.setValue(this.cmCodes.html || '');
		this.cm.css.setValue(this.cmCodes.css || '');
		this.cm.js.setValue(this.cmCodes.js || '');
		this.cm.html.refresh();
		this.cm.css.refresh();
		this.cm.js.refresh();

		this.clearConsole();

		// Set preview only when all modes are updated so that preview doesn't generate on partially
		// correct modes and also doesn't happen 3 times.
		Promise.all([
			this.updateHtmlMode(this.props.currentItem.htmlMode),
			this.updateCssMode(this.props.currentItem.cssMode),
			this.updateJsMode(this.props.currentItem.jsMode)
		]).then(() => this.setPreviewContent(true));
	}
	applyCodemirrorSettings(prefs) {
		document.documentElement.style.setProperty(
			'--code-font-size',
			`${parseInt(prefs.fontSize, 10)}px`
		);

		// Replace correct css file in LINK tags's href
		if (prefs.editorTheme) {
			window.editorThemeLinkTag.href = `lib/codemirror/theme/${prefs.editorTheme}.css`;
		}

		window.fontStyleTag.textContent =
			window.fontStyleTemplate.textContent.replace(
				/fontname/g,
				(prefs.editorFont === 'other'
					? prefs.editorCustomFont
					: prefs.editorFont) || 'FiraCode'
			);
	}

	// Check all the code wrap if they are minimized or maximized
	updateCodeWrapCollapseStates() {
		// This is debounced!
		clearTimeout(this.updateCodeWrapCollapseStates.timeout);
		this.updateCodeWrapCollapseStates.timeout = setTimeout(() => {
			const { currentLayoutMode } = this.props;
			const prop =
				currentLayoutMode === 2 || currentLayoutMode === 5 ? 'width' : 'height';
			[htmlCodeEl, cssCodeEl, jsCodeEl].forEach(function (el) {
				const bounds = el.getBoundingClientRect();
				const size = bounds[prop];
				if (size < 100) {
					el.classList.add('is-minimized');
				} else {
					el.classList.remove('is-minimized');
				}
				if (el.style[prop].indexOf(`100% - ${minCodeWrapSize * 2}px`) !== -1) {
					el.classList.add('is-maximized');
				} else {
					el.classList.remove('is-maximized');
				}
			});
		}, 50);
	}

	toggleCodeWrapCollapse(codeWrapEl) {
		if (
			codeWrapEl.classList.contains('is-minimized') ||
			codeWrapEl.classList.contains('is-maximized')
		) {
			codeWrapEl.classList.remove('is-minimized');
			codeWrapEl.classList.remove('is-maximized');
			this.codeSplitInstance.setSizes([33.3, 33.3, 33.3]);
		} else {
			const id = parseInt(codeWrapEl.dataset.codeWrapId, 10);
			var arr = [
				`${minCodeWrapSize}px`,
				`${minCodeWrapSize}px`,
				`${minCodeWrapSize}px`
			];
			arr[id] = `calc(100% - ${minCodeWrapSize * 2}px)`;

			this.codeSplitInstance.setSizes(arr);
			codeWrapEl.classList.add('is-maximized');
		}
		this.updateSplits();
	}

	collapseBtnHandler(e) {
		var codeWrapParent =
			e.currentTarget.parentElement.parentElement.parentElement;
		this.toggleCodeWrapCollapse(codeWrapParent);
		trackEvent('ui', 'paneCollapseBtnClick', codeWrapParent.dataset.type);
	}
	codeWrapHeaderDblClickHandler(e) {
		if (!e.target.classList.contains('js-code-wrap__header')) {
			return;
		}
		const codeWrapParent = e.target.parentElement;
		this.toggleCodeWrapCollapse(codeWrapParent);
		trackEvent('ui', 'paneHeaderDblClick', codeWrapParent.dataset.type);
	}

	resetSplitting() {
		this.setState({
			codeSplitSizes: sanitizeSplitSizes(this.getCodeSplitSizes()),
			mainSplitSizes: sanitizeSplitSizes(this.getMainSplitSizesToApply())
		});
	}
	updateSplits(sizes) {
		// HACK: This is weird thing happening. We call `onSplitUpdate` on parent. That calculates
		// and sets sizes from the DOM on the currentItem. And then we read that size to update
		// this component's state (codeSplitSizes and mainSPlitSizes).
		// If we don't update, then some re-render will reset the pane sizes as ultimately the state
		// variables here govern the split.
		this.props.onSplitUpdate(sizes);

		// Not using setState to avoid re-render
		this.state.codeSplitSizes = this.props.currentItem.sizes;
		this.state.mainSplitSizes = this.props.currentItem.mainSizes;
	}

	// Returns the sizes of main code & preview panes.
	getMainSplitSizesToApply() {
		var mainSplitSizes;
		const { currentItem, currentLayoutMode } = this.props;
		if (currentItem && currentItem.mainSizes) {
			// For layout mode 3, main panes are reversed using flex-direction.
			// So we need to apply the saved sizes in reverse order.
			mainSplitSizes =
				currentLayoutMode === 3
					? [currentItem.mainSizes[1], currentItem.mainSizes[0]]
					: currentItem.mainSizes;
		} else {
			mainSplitSizes = currentLayoutMode === 5 ? [75, 25] : [50, 50];
		}
		return mainSplitSizes;
	}

	getCodeSplitSizes() {
		if (this.props.currentItem && this.props.currentItem.sizes) {
			return this.props.currentItem.sizes;
		}
		return [33.33, 33.33, 33.33];
	}

	mainSplitDragEndHandler(sizes) {
		if (this.props.prefs.refreshOnResize) {
			// Running preview updation in next call stack, so that error there
			// doesn't affect this dragend listener.
			setTimeout(() => {
				this.setPreviewContent(true);
			}, 1);
		}
		this.updateSplits(sizes);
	}
	mainSplitDragHandler() {
		this.previewDimension.update({
			w: this.frame.clientWidth,
			h: this.frame.clientHeight
		});
	}
	codeSplitDragStart() {
		document.body.classList.add('is-dragging');
	}
	codeSplitDragEnd(sizes) {
		this.updateCodeWrapCollapseStates();
		document.body.classList.remove('is-dragging');
		this.updateSplits(sizes);
	}

	updateHtmlMode(value) {
		this.props.onCodeModeChange('html', value);
		this.props.currentItem.htmlMode = value;
		this.cm.html.setLanguage(value);
		return handleModeRequirements(value);
	}
	updateCssMode(value) {
		this.props.onCodeModeChange('css', value);
		this.props.currentItem.cssMode = value;
		this.cm.css.setOption('readOnly', modes[value].cmDisable);
		this.cm.css.setLanguage(value);
		return handleModeRequirements(value);
	}
	updateJsMode(value) {
		this.props.onCodeModeChange('js', value);
		this.props.currentItem.jsMode = value;
		this.cm.js.setLanguage(value);
		return handleModeRequirements(value);
	}
	codeModeChangeHandler(e) {
		var mode = e.target.value;
		var type = e.target.dataset.type;
		var currentMode =
			this.props.currentItem[
				type === 'html' ? 'htmlMode' : type === 'css' ? 'cssMode' : 'jsMode'
			];
		if (currentMode !== mode) {
			if (type === 'html') {
				this.updateHtmlMode(mode).then(() => this.setPreviewContent(true));
			} else if (type === 'js') {
				this.updateJsMode(mode).then(() => this.setPreviewContent(true));
			} else if (type === 'css') {
				this.updateCssMode(mode).then(() => this.setPreviewContent(true));
			}
			trackEvent('ui', 'updateCodeMode', mode);
		}
	}

	detachPreview() {
		if (this.detachedWindow) {
			this.detachedWindow.focus();
			return;
		}
		const iframeBounds = this.frame.getBoundingClientRect();
		const iframeWidth = iframeBounds.width;
		const iframeHeight = iframeBounds.height;
		document.body.classList.add('is-detached-mode');

		this.detachedWindow = window.open(
			'./preview.html',
			'42Pen',
			`width=${iframeWidth},height=${iframeHeight},resizable,scrollbars=yes,status=1`
		);
		// Trigger initial render in detached window
		setTimeout(() => {
			this.setPreviewContent(true);
		}, 1500);

		var intervalID = window.setInterval(checkWindow => {
			if (this.detachedWindow && this.detachedWindow.closed) {
				clearInterval(intervalID);
				document.body.classList.remove('is-detached-mode');
				this.detachedWindow = null;
				// Update main frame preview to get latest changes (which were not
				// getting reflected while detached window was open)
				this.setPreviewContent(true);
			}
		}, 500);
	}

	onMessageFromConsole() {
		const logs = [...arguments].map(arg => {
			if (
				arg &&
				arg.indexOf &&
				arg.indexOf('filesystem:chrome-extension') !== -1
			) {
				return arg.replace(
					/filesystem:chrome-extension.*\.js:(\d+):*(\d*)/g,
					'script $1:$2'
				);
			}
			return arg;
		});
		this.setState({ logs: [...this.state.logs, ...logs] });
	}

	previewException(error) {
		console.error('Possible infinite loop detected.', error.stack);
		this.onMessageFromConsole('Possible infinite loop detected.', error.stack);
	}

	toggleConsole() {
		const newValue = !this.state.isConsoleOpen;
		this.setState({ isConsoleOpen: newValue });
		trackEvent('ui', 'consoleToggle');
		window.localStorage.setItem(LocalStorageKeys.WAS_CONSOLE_OPEN, newValue);
	}
	consoleHeaderDblClickHandler(e) {
		if (!e.target.classList.contains('js-console__header')) {
			return;
		}
		trackEvent('ui', 'consoleToggleDblClick');
		this.toggleConsole();
	}
	clearConsole() {
		this.setState({ logs: [] });
	}
	clearConsoleBtnClickHandler() {
		this.clearConsole();
		trackEvent('ui', 'consoleClearBtnClick');
	}

	evalConsoleExpr(e) {
		// Clear console on CTRL + L
		if ((e.which === 76 || e.which === 12) && e.ctrlKey) {
			this.clearConsole();
			trackEvent('ui', 'consoleClearKeyboardShortcut');
		} else if (e.which === 13) {
			this.onMessageFromConsole('> ' + e.target.value);

			/* eslint-disable no-underscore-dangle */
			this.frame.contentWindow._wmEvaluate(e.target.value);

			/* eslint-enable no-underscore-dangle */

			e.target.value = '';
			trackEvent('fn', 'evalConsoleExpr');
		}
	}
	cssSettingsBtnClickHandler() {
		this.setState({ isCssSettingsModalOpen: true });
		trackEvent('ui', 'cssSettingsBtnClick');
	}
	cssSettingsChangeHandler(settings) {
		this.props.onCodeSettingsChange('css', settings);
		this.setPreviewContent(true);
	}
	getDemoFrame(callback) {
		callback(this.frame);
	}
	editorFocusHandler(editor) {
		this.props.onEditorFocus(editor);
	}
	prettifyBtnClickHandler(codeType) {
		this.props.onPrettifyBtnClick(codeType);
	}

	dismissPreviewNotWorkingModal() {
		this.setState({
			isPreviewNotWorkingModalVisible: false
		});
		window.sessionStorage.setItem('previewErrorMessageDismissed', true);
	}

	render() {
		// log('contentwrap update');

		return (
			<SplitPane
				class="content-wrap  flex  flex-grow"
				sizes={this.state.mainSplitSizes}
				minSize={150}
				style=""
				direction={
					this.props.currentLayoutMode === 2 ? 'vertical' : 'horizontal'
				}
				onDrag={this.mainSplitDragHandler.bind(this)}
				onDragEnd={this.mainSplitDragEndHandler.bind(this)}
			>
				<SplitPane
					class="code-side"
					id="js-code-side"
					sizes={this.state.codeSplitSizes}
					minSize={minCodeWrapSize}
					direction={
						this.props.currentLayoutMode === 2 ||
						this.props.currentLayoutMode === 5
							? 'horizontal'
							: 'vertical'
					}
					onDragStart={this.codeSplitDragStart.bind(this)}
					onDragEnd={this.codeSplitDragEnd.bind(this)}
					onSplit={splitInstance => (this.codeSplitInstance = splitInstance)}
				>
					<div
						data-code-wrap-id="0"
						id="htmlCodeEl"
						data-type="html"
						class="code-wrap"
						onTransitionEnd={this.updateCodeWrapCollapseStates.bind(this)}
					>
						<div
							class="js-code-wrap__header  code-wrap__header"
							title="Double click to toggle code pane"
							onDblClick={this.codeWrapHeaderDblClickHandler.bind(this)}
						>
							<label class="btn-group" dropdow title="Click to change">
								<span class="code-wrap__header-label">
									{modes[this.props.currentItem.htmlMode || 'html'].label}
								</span>
								<span class="caret" />
								<select
									data-type="html"
									class="js-mode-select  hidden-select"
									onChange={this.codeModeChangeHandler.bind(this)}
									value={this.props.currentItem.htmlMode}
								>
									<option value="html">HTML</option>
									<option value="markdown">Markdown</option>
									<option value="jade">Pug</option>
								</select>
							</label>
							<div class="code-wrap__header-right-options">
								{this.props.currentItem.htmlMode === HtmlModes.HTML ? (
									<a
										class="code-wrap__header-btn"
										title="Format code"
										onClick={this.prettifyBtnClickHandler.bind(this, 'html')}
									>
										<svg>
											<use xlinkHref="#code-brace-icon" />
										</svg>
									</a>
								) : null}
								<a
									class="js-code-collapse-btn  code-wrap__header-btn  code-wrap__collapse-btn"
									title="Toggle code pane"
									onClick={this.collapseBtnHandler.bind(this)}
								/>
							</div>
						</div>
						<CodeEditor
							type={
								window.forcedSettings.isMonacoEditorOn === true ||
								(this.props.prefs.isMonacoEditorOn &&
									window.forcedSettings.isMonacoEditorOn !== false)
									? 'monaco'
									: 'codemirror'
							}
							options={{
								mode: 'htmlmixed',
								profile: 'xhtml',
								gutters: ['CodeMirror-linenumbers', 'CodeMirror-foldgutter'],
								noAutocomplete: true,
								matchTags: { bothTags: true },
								prettier: true,
								prettierParser: 'html',
								emmet: true
							}}
							prefs={this.props.prefs}
							onChange={this.onHtmlCodeChange.bind(this)}
							ref={editor => (this.cm.html = editor)}
							onFocus={this.editorFocusHandler.bind(this)}
						/>
					</div>
					<div
						data-code-wrap-id="1"
						id="cssCodeEl"
						data-type="css"
						class="code-wrap"
						onTransitionEnd={this.updateCodeWrapCollapseStates.bind(this)}
					>
						<div
							class="js-code-wrap__header  code-wrap__header"
							title="Double click to toggle code pane"
							onDblClick={this.codeWrapHeaderDblClickHandler.bind(this)}
						>
							<label class="btn-group" title="Click to change">
								<span class="code-wrap__header-label">
									{modes[this.props.currentItem.cssMode || 'css'].label}
								</span>
								<span class="caret" />
								<select
									data-type="css"
									class="js-mode-select  hidden-select"
									onChange={this.codeModeChangeHandler.bind(this)}
									value={this.props.currentItem.cssMode}
								>
									<option value="css">CSS</option>
									<option value="scss">SCSS</option>
									<option value="sass">SASS</option>
									<option value="less">LESS</option>
									<option value="stylus">Stylus</option>
									<option value="acss">Atomic CSS</option>
								</select>
							</label>
							<div class="code-wrap__header-right-options">
								{modes[this.props.currentItem.cssMode || 'css'].hasSettings && (
									<a
										href="#"
										id="cssSettingsBtn"
										title="Atomic CSS configuration"
										onClick={this.cssSettingsBtnClickHandler.bind(this)}
										class="code-wrap__header-btn"
									>
										<svg>
											<use xlinkHref="#settings-icon" />
										</svg>
									</a>
								)}
								<a
									class="code-wrap__header-btn "
									title="Format code"
									onClick={this.prettifyBtnClickHandler.bind(this, 'css')}
								>
									<svg>
										<use xlinkHref="#code-brace-icon" />
									</svg>
								</a>
								<a
									class="js-code-collapse-btn  code-wrap__header-btn  code-wrap__collapse-btn"
									title="Toggle code pane"
									onClick={this.collapseBtnHandler.bind(this)}
								/>
							</div>
						</div>
						<CodeEditor
							type={
								window.forcedSettings.isMonacoEditorOn === true ||
								(this.props.prefs.isMonacoEditorOn &&
									window.forcedSettings.isMonacoEditorOn !== false)
									? 'monaco'
									: 'codemirror'
							}
							options={{
								mode: 'css',
								gutters: [
									'error-gutter',
									'CodeMirror-linenumbers',
									'CodeMirror-foldgutter'
								],
								emmet: true,
								prettier: true,
								prettierParser: 'css'
							}}
							prefs={this.props.prefs}
							onChange={this.onCssCodeChange.bind(this)}
							ref={editor => (this.cm.css = editor)}
							onFocus={this.editorFocusHandler.bind(this)}
						/>
					</div>
					<div
						data-code-wrap-id="2"
						id="jsCodeEl"
						data-type="js"
						class="code-wrap"
						onTransitionEnd={this.updateCodeWrapCollapseStates.bind(this)}
					>
						<div
							class="js-code-wrap__header  code-wrap__header"
							title="Double click to toggle code pane"
							onDblClick={this.codeWrapHeaderDblClickHandler.bind(this)}
						>
							<label class="btn-group" title="Click to change">
								<span class="code-wrap__header-label">
									{modes[this.props.currentItem.jsMode || 'js'].label}
								</span>
								<span class="caret" />
								<select
									data-type="js"
									class="js-mode-select  hidden-select"
									onChange={this.codeModeChangeHandler.bind(this)}
									value={this.props.currentItem.jsMode}
								>
									<option value="js">JS</option>
									<option value="coffee">CoffeeScript</option>
									<option value="es6">ES6 (Babel)</option>
									<option value="typescript">TypeScript</option>
								</select>
							</label>
							<div class="code-wrap__header-right-options">
								<a
									class="code-wrap__header-btn "
									title="Format code"
									onClick={this.prettifyBtnClickHandler.bind(this, 'css')}
								>
									<svg>
										<use xlinkHref="#code-brace-icon" />
									</svg>
								</a>
								<a
									class="js-code-collapse-btn  code-wrap__header-btn  code-wrap__collapse-btn"
									title="Toggle code pane"
									onClick={this.collapseBtnHandler.bind(this)}
								/>
							</div>
						</div>
						<CodeEditor
							type={
								window.forcedSettings.isMonacoEditorOn === true ||
								(this.props.prefs.isMonacoEditorOn &&
									window.forcedSettings.isMonacoEditorOn !== false)
									? 'monaco'
									: 'codemirror'
							}
							options={{
								mode: 'javascript',
								gutters: [
									'error-gutter',
									'CodeMirror-linenumbers',
									'CodeMirror-foldgutter'
								],
								prettier: true,
								prettierParser: 'js'
							}}
							prefs={this.props.prefs}
							autoComplete={this.props.prefs.autoComplete}
							onChange={this.onJsCodeChange.bind(this)}
							ref={editor => (this.cm.js = editor)}
							onFocus={this.editorFocusHandler.bind(this)}
						/>
						{/* Inlet(scope.cm.js); */}
					</div>
				</SplitPane>
				<div class="demo-side" id="js-demo-side" style="">
					<iframe
						ref={el => (this.frame = el)}
						frameborder="0"
						id="demo-frame"
						allowfullscreen
					/>

					<PreviewDimension ref={comp => (this.previewDimension = comp)} />

					<Console
						logs={this.state.logs}
						isConsoleOpen={this.state.isConsoleOpen}
						onConsoleHeaderDblClick={this.consoleHeaderDblClickHandler}
						onClearConsoleBtnClick={this.clearConsoleBtnClickHandler}
						toggleConsole={this.toggleConsole}
						onEvalInputKeyup={this.evalConsoleExpr}
					/>

					<CssSettingsModal
						show={this.state.isCssSettingsModalOpen}
						closeHandler={() =>
							this.setState({ isCssSettingsModalOpen: false })
						}
						onChange={this.cssSettingsChangeHandler.bind(this)}
						settings={this.props.currentItem.cssSettings}
						editorTheme={this.props.prefs.editorTheme}
					/>

					<Modal
						show={this.state.isPreviewNotWorkingModalVisible}
						closeHandler={this.dismissPreviewNotWorkingModal}
					>
						<h1>🔴 JavaScript preview not working!</h1>
						<p>
							Latest version of Chrome has changed a few things because of which
							JavaScript preview has stopped working.
						</p>

						<p>
							If you want to work with just HTML & CSS, you can still continue
							here. Otherwise, it is recommended to switch to the 42Pen web app
							which is much more powerful and works offline too -{' '}
							<a href="https://webmaker.app/app" target="_blank">
								Go to web app
							</a>
						</p>
						<div class="flex flex-h-end">
							<button
								class="btn btn--primary"
								onClick={this.dismissPreviewNotWorkingModal}
							>
								Dismiss
							</button>
						</div>
					</Modal>
				</div>
			</SplitPane>
		);
	}
}
