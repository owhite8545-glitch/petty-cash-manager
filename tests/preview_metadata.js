/**
 * Preview Deployment Metadata Resolver
 * 
 * Automatically resolves the live Vercel Preview URL, Deployment ID, Git commit SHA,
 * branch name, and deployment status from GitHub Deployments API.
 */

const https = require('https');
const { execSync } = require('child_process');

function fetchJson(url) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { 'User-Agent': 'PettyCash-Deploy-Resolver/1.0' } }, res => {
      let d = '';
      res.on('data', chunk => d += chunk);
      res.on('end', () => {
        try {
          resolve(JSON.parse(d));
        } catch (e) {
          reject(new Error(`Failed to parse JSON from ${url}: ${d.substring(0, 100)}`));
        }
      });
    }).on('error', reject);
  });
}

async function resolvePreviewDeployment() {
  const currentCommit = execSync('git rev-parse HEAD', { encoding: 'utf8' }).trim();
  const currentBranch = execSync('git rev-parse --abbrev-ref HEAD', { encoding: 'utf8' }).trim();

  const deployments = await fetchJson('https://api.github.com/repos/owhite8545-glitch/petty-cash-manager/deployments');
  if (!Array.isArray(deployments)) {
    throw new Error('Could not fetch deployments from GitHub API');
  }

  // Filter Preview deployments
  const previewDeps = deployments.filter(d => d.environment === 'Preview');
  if (previewDeps.length === 0) {
    throw new Error('No Preview deployments found for repository');
  }

  // Look for exact match on current HEAD commit
  let targetDep = previewDeps.find(d => d.ref === currentCommit);
  let isHeadMatch = true;

  if (!targetDep) {
    // If current commit has not finished deploying yet, get the latest Preview deployment
    targetDep = previewDeps[0];
    isHeadMatch = false;
  }

  const statuses = await fetchJson(targetDep.statuses_url);
  const latestStatus = Array.isArray(statuses) && statuses.length > 0 ? statuses[0] : null;

  const previewUrl = latestStatus 
    ? (latestStatus.environment_url || latestStatus.target_url) 
    : targetDep.payload?.web_url;

  return {
    previewUrl,
    deploymentId: targetDep.id,
    commitSha: targetDep.ref,
    currentHeadSha: currentCommit,
    branch: currentBranch,
    isHeadMatch: targetDep.ref === currentCommit,
    deploymentStatus: latestStatus ? latestStatus.state : 'unknown'
  };
}

module.exports = { resolvePreviewDeployment };
