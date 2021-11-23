"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    Object.defineProperty(o, k2, { enumerable: true, get: function() { return m[k]; } });
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || function (mod) {
    if (mod && mod.__esModule) return mod;
    var result = {};
    if (mod != null) for (var k in mod) if (k !== "default" && Object.prototype.hasOwnProperty.call(mod, k)) __createBinding(result, mod, k);
    __setModuleDefault(result, mod);
    return result;
};
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const core_1 = __importDefault(require("@actions/core"));
const fs_1 = __importDefault(require("fs"));
const github_1 = __importStar(require("@actions/github"));
const os_1 = __importDefault(require("os"));
const path_1 = __importDefault(require("path"));
function run() {
    return __awaiter(this, void 0, void 0, function* () {
        try {
            core_1.default.debug(` Available environment variables:\n -> ${Object.keys(process.env)
                .map((i) => `${i} :: ${process.env[i]}`)
                .join('\n -> ')}`);
            const dir = fs_1.default
                .readdirSync(path_1.default.resolve(process.env.GITHUB_WORKSPACE), { withFileTypes: true })
                .map((entry) => {
                return `${entry.isDirectory() ? '> ' : '  - '}${entry.name}`;
            })
                .join('\n');
            core_1.default.debug(` Working Directory: ${process.env.GITHUB_WORKSPACE}:\n${dir}`);
            if (!Object.prototype.hasOwnProperty.call(process.env, 'GITHUB_TOKEN')) {
                if (!Object.prototype.hasOwnProperty.call(process.env, 'INPUT_GITHUB_TOKEN')) {
                    core_1.default.setFailed('Invalid or missing GITHUB_TOKEN.');
                    return;
                }
            }
            const pkgRoot = core_1.default.getInput('package_root', { required: false });
            const pkgfile = path_1.default.join(process.env.GITHUB_WORKSPACE, pkgRoot, 'package.json');
            if (!fs_1.default.existsSync(pkgfile)) {
                core_1.default.setFailed('package.json does not exist.');
                return;
            }
            const pkg = require(pkgfile);
            core_1.default.setOutput('version', pkg.version);
            core_1.default.debug(` Detected version ${pkg.version}`);
            // Get authenticated GitHub client (Ocktokit): https://github.com/actions/toolkit/tree/master/packages/github#usage
            const octokit = github_1.default.getOctokit(process.env.GITHUB_TOKEN || process.env.INPUT_GITHUB_TOKEN);
            // Get owner and repo from context of payload that triggered the action
            const { owner, repo } = github_1.context.repo;
            // // Check for existing tag
            // const git = new github.GitHub(process.env.INPUT_GITHUB_TOKEN || process.env.GITHUB_TOKEN)
            // const owner = process.env.GITHUB_REPOSITORY.split('/').shift()
            // const repo = process.env.GITHUB_REPOSITORY.split('/').pop()
            let tags;
            try {
                tags = yield octokit.rest.repos.listTags({
                    owner,
                    repo,
                    per_page: 100,
                });
            }
            catch (e) {
                tags = {
                    data: [],
                };
            }
            const tagPrefix = core_1.default.getInput('tag_prefix', { required: false });
            const tagSuffix = core_1.default.getInput('tag_suffix', { required: false });
            const changelogStructure = core_1.default.getInput('changelog_structure', { required: false });
            const getTagName = (version) => {
                return `${tagPrefix}${version}${tagSuffix}`;
            };
            // Check for existance of tag and abort (short circuit) if it already exists.
            for (const tag of tags.data) {
                if (tag.name === getTagName(pkg.version)) {
                    core_1.default.warning(`"${tag.name.trim()}" tag already exists.${os_1.default.EOL}`);
                    core_1.default.setOutput('tagname', '');
                    return;
                }
            }
            // Create the new tag name
            const tagName = getTagName(pkg.version);
            let tagMsg = core_1.default.getInput('tag_message', { required: false }).trim();
            if (tagMsg.length === 0 && tags.data.length > 0) {
                try {
                    const latestTag = tags.data.shift();
                    const changelog = yield octokit.rest.repos.compareCommits({
                        owner,
                        repo,
                        base: latestTag.name,
                        head: 'master',
                    });
                    const structure = changelogStructure || `**1) {{message}}** {{author}}\n(SHA: {{sha}})\n`;
                    tagMsg = changelog.data.commits
                        .map((commit) => structure.replace(/({{message}})|({{messageHeadline}})|({{author}})|({{sha}})/g, (match, message, messageHeadline, author, sha) => {
                        if (message)
                            return commit.commit.message;
                        if (messageHeadline)
                            return commit.commit.message.split('\n')[0];
                        if (author)
                            return !Object.prototype.hasOwnProperty.call(commit, 'author') ||
                                !Object.prototype.hasOwnProperty.call(commit.author, 'login')
                                ? ''
                                : commit.author.login;
                        if (sha)
                            return commit.sha;
                    }))
                        .join('\n');
                }
                catch (e) {
                    core_1.default.warning(`Failed to generate changelog from commits: ${e.message}${os_1.default.EOL}`);
                    tagMsg = tagName;
                }
            }
            let newTag;
            try {
                tagMsg = tagMsg.trim().length > 0 ? tagMsg : `Version ${pkg.version}`;
                newTag = yield octokit.rest.git.createTag({
                    owner,
                    repo,
                    tag: tagName,
                    message: tagMsg,
                    object: process.env.GITHUB_SHA,
                    type: 'commit',
                });
                core_1.default.warning(`Created new tag: ${newTag.data.tag}`);
            }
            catch (e) {
                core_1.default.setFailed(e.message);
                return;
            }
            let newReference;
            try {
                newReference = yield octokit.rest.git.createRef({
                    owner,
                    repo,
                    ref: `refs/tags/${newTag.data.tag}`,
                    sha: newTag.data.sha,
                });
                core_1.default.warning(`Reference ${newReference.data.ref} available at ${newReference.data.url}${os_1.default.EOL}`);
            }
            catch (e) {
                core_1.default.setFailed(e.message);
                return;
            }
            // Store values for other actions
            if (typeof newTag === 'object' && typeof newReference === 'object') {
                core_1.default.setOutput('tagname', tagName);
                core_1.default.setOutput('tagsha', newTag.data.sha);
                core_1.default.setOutput('taguri', newReference.data.url);
                core_1.default.setOutput('tagmessage', tagMsg.trim());
                core_1.default.setOutput('tagref', newReference.data.ref);
            }
        }
        catch (error) {
            core_1.default.warning(error.message);
            core_1.default.setOutput('tagname', '');
            core_1.default.setOutput('tagsha', '');
            core_1.default.setOutput('taguri', '');
            core_1.default.setOutput('tagmessage', '');
            core_1.default.setOutput('tagref', '');
        }
    });
}
run();
