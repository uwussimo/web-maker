import { h } from 'preact';
import { Button } from './common';
import { Trans, NumberFormat, t } from '@lingui/macro';
import { I18n } from '@lingui/react';

const DEFAULT_PROFILE_IMG =
	"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'%3E%3Cpath fill='%23ccc' d='M12,19.2C9.5,19.2 7.29,17.92 6,16C6.03,14 10,12.9 12,12.9C14,12.9 17.97,14 18,16C16.71,17.92 14.5,19.2 12,19.2M12,5A3,3 0 0,1 15,8A3,3 0 0,1 12,11A3,3 0 0,1 9,8A3,3 0 0,1 12,5M12,2A10,10 0 0,0 2,12A10,10 0 0,0 12,22A10,10 0 0,0 22,12C22,6.47 17.5,2 12,2Z'/%3E%3C/svg%3E";

export function MainHeader(props) {
	const isAutoPreviewOn =
		window.forcedSettings.autoPreview !== undefined
			? window.forcedSettings
			: props.isAutoPreviewOn;

	return (
		<I18n>
			{({ i18n }) => (
				<div class="main-header">
					<input
						type="text"
						id="titleInput"
						title="Click to edit"
						class="item-title-input"
						value={props.title}
						onBlur={props.titleInputBlurHandler}
					/>
					<div class="main-header__btn-wrap  flex  flex-v-center">
						{!isAutoPreviewOn && (
							<button
								class="btn btn btn--dark flex flex-v-center hint--rounded hint--bottom-left"
								aria-label={i18n._(t`Run preview (Ctrl/⌘ + Shift + 5)`)}
								onClick={props.runBtnClickHandler}
							>
								<svg>
									<use xlinkHref="#play-icon" />
								</svg>
								<Trans>Run</Trans>
							</button>
						)}

						{!props.isFileMode && (
							<Button
								onClick={props.addLibraryBtnHandler}
								data-event-category="ui"
								data-event-action="addLibraryButtonClick"
								data-testid="addLibraryButton"
								class="btn btn--dark hint--rounded hint--bottom-left"
								aria-label={i18n._(t`Add a JS/CSS library`)}
							>
								<Trans>Add library</Trans>{' '}
								<span
									id="js-external-lib-count"
									style={`display:${
										props.externalLibCount ? 'inline' : 'none'
									}`}
									class="count-label"
								>
									<NumberFormat value={props.externalLibCount} />
								</span>
							</Button>
						)}

						<button
							class="btn btn--dark hint--rounded hint--bottom-left"
							aria-label={i18n._(t`Start a new creation`)}
							data-testid="newButton"
							onClick={props.newBtnHandler}
						>
							<svg viewBox="0 0 24 24">
								<path d="M19,13H13V19H11V13H5V11H11V5H13V11H19V13Z" />
							</svg>
							<Trans>New</Trans>
						</button>
						<button
							id="saveBtn"
							class={`btn btn--dark hint--rounded hint--bottom-left ${
								props.isSaving ? 'is-loading' : ''
							} ${props.unsavedEditCount ? 'is-marked' : 0}`}
							aria-label={i18n._(t`Save current creation (Ctrl/⌘ + S)`)}
							onClick={props.saveBtnHandler}
						>
							<svg viewBox="0 0 24 24">
								<path d="M15,9H5V5H15M12,19A3,3 0 0,1 9,16A3,3 0 0,1 12,13A3,3 0 0,1 15,16A3,3 0 0,1 12,19M17,3H5C3.89,3 3,3.9 3,5V19A2,2 0 0,0 5,21H19A2,2 0 0,0 21,19V7L17,3Z" />
							</svg>
							<svg class="btn-loader" width="15" height="15" stroke="#fff">
								<use xlinkHref="#loader-icon" />
							</svg>
							<Trans>Save</Trans>
						</button>
						<button
							id="openItemsBtn"
							class={`btn btn--dark hint--rounded hint--bottom-left ${
								props.isFetchingItems ? 'is-loading' : ''
							}`}
							aria-label={i18n._(t`Open a saved creation (Ctrl/⌘ + O)`)}
							onClick={props.openBtnHandler}
						>
							<svg viewBox="0 0 24 24">
								<path d="M13,9V3.5L18.5,9M6,2C4.89,2 4,2.89 4,4V20A2,2 0 0,0 6,22H18A2,2 0 0,0 20,20V8L14,2H6Z" />
							</svg>
							<svg class="btn-loader" width="15" height="15" stroke="#fff">
								<use xlinkHref="#loader-icon" />
							</svg>
							<Trans>Open</Trans>
						</button>
						{/* {!props.user ? (
							<Button
								onClick={props.loginBtnHandler}
								data-event-category="ui"
								data-event-action="loginButtonClick"
								data-testid="loginButton"
								class="btn btn--dark hint--rounded  hint--bottom-left"
							>
								<Trans>Login/Signup</Trans>
							</Button>
						) : (
							<Button
								onClick={props.profileBtnHandler}
								data-event-category="ui"
								data-event-action="headerAvatarClick"
								aria-label={i18n._(t`See profile or Logout`)}
								class="btn--dark hint--rounded  hint--bottom-left"
							>
								<img
									id="headerAvatarImg"
									width="20"
									src={
										props.user ? props.user.photoURL || DEFAULT_PROFILE_IMG : ''
									}
									class="main-header__avatar-img"
								/>
							</Button>
						)} */}
					</div>
				</div>
			)}
		</I18n>
	);
}
