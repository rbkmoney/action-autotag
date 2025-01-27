import * as core from '@actions/core';
import fs from 'fs';
import github, { context } from '@actions/github';
import os from 'os';
import path from 'path';

async function run() {
	try {
		core.debug(
			` Available environment variables:\n -> ${Object.keys(process.env)
				.map((i) => `${i} :: ${process.env[i]}`)
				.join('\n -> ')}`
		);

		const dir = fs
			.readdirSync(path.resolve(process.env.GITHUB_WORKSPACE), { withFileTypes: true })
			.map((entry) => {
				return `${entry.isDirectory() ? '> ' : '  - '}${entry.name}`;
			})
			.join('\n');

		core.debug(` Working Directory: ${process.env.GITHUB_WORKSPACE}:\n${dir}`);

		const githubToken = core.getInput('github_token');
		if (!githubToken) {
			core.setFailed('Invalid or missing GITHUB_TOKEN.');
			return;
		}

		const pkgRoot = core.getInput('package_root', { required: false });
		const pkgfile = path.join(process.env.GITHUB_WORKSPACE, pkgRoot, 'package.json');
		if (!fs.existsSync(pkgfile)) {
			core.setFailed('package.json does not exist.');
			return;
		}

		const pkg = require(pkgfile);
		core.setOutput('version', pkg.version);
		core.debug(` Detected version ${pkg.version}`);

		// Get authenticated GitHub client (Ocktokit): https://github.com/actions/toolkit/tree/master/packages/github#usage
		const octokit = github.getOctokit(githubToken);

		// Get owner and repo from context of payload that triggered the action
		const { owner, repo } = context.repo;

		// // Check for existing tag
		// const git = new github.GitHub(process.env.INPUT_GITHUB_TOKEN || process.env.GITHUB_TOKEN)
		// const owner = process.env.GITHUB_REPOSITORY.split('/').shift()
		// const repo = process.env.GITHUB_REPOSITORY.split('/').pop()

		let tags;
		try {
			tags = await octokit.rest.repos.listTags({
				owner,
				repo,
				per_page: 100,
			});
		} catch (e) {
			tags = {
				data: [],
			};
		}

		const tagPrefix = core.getInput('tag_prefix', { required: false });
		const tagSuffix = core.getInput('tag_suffix', { required: false });
		const changelogStructure = core.getInput('changelog_structure', { required: false });

		const getTagName = (version) => {
			return `${tagPrefix}${version}${tagSuffix}`;
		};

		// Check for existance of tag and abort (short circuit) if it already exists.
		for (const tag of tags.data) {
			if (tag.name === getTagName(pkg.version)) {
				core.warning(`"${tag.name.trim()}" tag already exists.${os.EOL}`);
				core.setOutput('tagname', '');
				return;
			}
		}

		// Create the new tag name
		const tagName = getTagName(pkg.version);

		let tagMsg = core.getInput('tag_message', { required: false }).trim();
		if (tagMsg.length === 0 && tags.data.length > 0) {
			try {
				const latestTag = tags.data.shift();

				const changelog = await octokit.rest.repos.compareCommits({
					owner,
					repo,
					base: latestTag.name,
					head: 'master',
				});
				const structure = changelogStructure || `**1) {{message}}** {{author}}\n(SHA: {{sha}})\n`;

				tagMsg = changelog.data.commits
					.map((commit) =>
						structure.replace(
							/({{message}})|({{messageHeadline}})|({{author}})|({{sha}})/g,
							(match, message, messageHeadline, author, sha) => {
								if (message) return commit.commit.message;
								if (messageHeadline) return commit.commit.message.split('\n')[0];
								if (author)
									return !Object.prototype.hasOwnProperty.call(commit, 'author') ||
										!Object.prototype.hasOwnProperty.call(commit.author, 'login')
										? ''
										: commit.author.login;
								if (sha) return commit.sha;
							}
						)
					)
					.join('\n');
			} catch (e) {
				core.warning(`Failed to generate changelog from commits: ${e.message}${os.EOL}`);
				tagMsg = tagName;
			}
		}

		let newTag;
		try {
			tagMsg = tagMsg.trim().length > 0 ? tagMsg : `Version ${pkg.version}`;

			newTag = await octokit.rest.git.createTag({
				owner,
				repo,
				tag: tagName,
				message: tagMsg,
				object: process.env.GITHUB_SHA,
				type: 'commit',
			});

			core.warning(`Created new tag: ${newTag.data.tag}`);
		} catch (e) {
			core.setFailed(e.message);
			return;
		}

		let newReference;
		try {
			newReference = await octokit.rest.git.createRef({
				owner,
				repo,
				ref: `refs/tags/${newTag.data.tag}`,
				sha: newTag.data.sha,
			});

			core.warning(`Reference ${newReference.data.ref} available at ${newReference.data.url}${os.EOL}`);
		} catch (e) {
			core.setFailed(e.message);
			return;
		}

		// Store values for other actions
		if (typeof newTag === 'object' && typeof newReference === 'object') {
			core.setOutput('tagname', tagName);
			core.setOutput('tagsha', newTag.data.sha);
			core.setOutput('taguri', newReference.data.url);
			core.setOutput('tagmessage', tagMsg.trim());
			core.setOutput('tagref', newReference.data.ref);
		}
	} catch (error) {
		core.error(error.message);
		core.setOutput('tagname', '');
		core.setOutput('tagsha', '');
		core.setOutput('taguri', '');
		core.setOutput('tagmessage', '');
		core.setOutput('tagref', '');
	}
}

run();
