#!/usr/bin/env ts-node

import { spawn, execSync } from 'child_process';
import { Command } from 'commander';

const program = new Command();

// An interface for storing author information
interface AuthorData {
    commitCount: number;
    commitTimes: number[];
    linesAdded: number;
    linesDeleted: number;
    score: number;
}

interface ScoreData extends AuthorData{
    scaledCommitCount: number;
}

const DEFAULT_REPO_URL = 'https://github.com/47Cid/chain-maker.git';
const DEFAULT_DIRECTORY = '.';


program
    .version('1.0.0')
    .description('Get top N authors based on scores')
    .option('-r, --repo <url>', 'Repository HTTPS link', DEFAULT_REPO_URL)
    .option('-d, --directory <path>', 'Directory path', DEFAULT_DIRECTORY)
    .argument('<number>', 'Number of top authors to return') // Take a number as an argument
    .action(async(topN: string, options) => {
        const repoUrl = options.repo;
        const directory = options.directory;

        console.log(`Using repository URL: ${repoUrl}`);
        console.log(`Using directory: ${directory}`);

        const topNumber = parseInt(topN, 10);
        if (isNaN(topNumber) || topNumber <= 0) {
            console.error('Please provide a valid positive number.');
            return;
        }

        // Git Clone
        let randomDir;
        try{
            randomDir = Math.random().toString(36).substring(2, 15);
            execSync(`mkdir ${randomDir}`);

            console.log("Starting git clone...");
            cloneGitRepo(repoUrl,randomDir);
            console.log("Git Clone Completed.");
            console.log("Starting Analysis...");
            const logData = await getGitLogStream(directory,randomDir);
            const scoreData = calculateScores(logData);
            const aggregateData = aggregateScores(scoreData);
            console.log(aggregateData);
        }catch(e){
            console.error("Repository clone failed: ", e);
            return;
        }
        finally{
            if(randomDir)
                execSync(`rm -rf ${randomDir}`);
        }
    });


program.parse(process.argv);

function cloneGitRepo(repoUrl: string, randomDir: string): void {
    execSync(`git -C ${randomDir} clone ${repoUrl} .`);
}

// Function to get git log details for a specific directory, including lines added/changed
function getGitLogStream(directory: string, REPO_PATH: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const logData: string[] = [];
      const gitLog = spawn('git', [
        '-C',
        REPO_PATH,
        'log',
        '--pretty=format:%ae %at',
        '--numstat',
        '--no-merges',
        '--',
        directory,
      ]);
  
      gitLog.stdout.on('data', (data) => {
        logData.push(data.toString());
      });
  
      gitLog.stderr.on('data', (data) => {
        console.error(`Error: ${data}`);
      });
  
      gitLog.on('close', (code) => {
        if (code === 0) {
          resolve(logData.join(''));
        } else {
          reject(new Error(`git log process exited with code ${code}`));
        }
      });
    });
}

function calculateScores(logData: string): Record<string, AuthorData> {
    const authorData: Record<string, AuthorData> = {};
  
    let currentAuthor: string | null = null;
    logData.split('\n').forEach(line => {
        if (line.includes('@')) {
            const [author, timestamp] = line.split(/ (?=\d{10})/); // Split based on the timestamp (10-digit UNIX time)
            currentAuthor = author;
            
    
            if (!authorData[currentAuthor]) {
            authorData[currentAuthor] = { commitCount: 0, commitTimes: [], linesAdded: 0, linesDeleted: 0, score: 0 };
            }
    
            authorData[currentAuthor].commitCount += 1;
            authorData[currentAuthor].commitTimes.push(parseInt(timestamp));
        } else if (currentAuthor && line.trim()) {
        // Process the lines added and deleted from the numstat output
            const [added, deleted] = line.split('\t');
            const linesAdded = added === '-' ? 0 : parseInt(added);
            const linesDeleted = deleted === '-' ? 0 : parseInt(deleted);
    
            authorData[currentAuthor].linesAdded += linesAdded;
            authorData[currentAuthor].linesDeleted += linesDeleted;
        }
    });

    return authorData;
}

function aggregateScores(authorData: Record<string, AuthorData>): Record<string, ScoreData> {
    const scoreData: Record<string, ScoreData> = {};

    Object.keys(authorData).forEach((author) => {
       const { commitCount, commitTimes, linesAdded, linesDeleted, score } = authorData[author];
       const scaledCommitCount = getScaledCommitCount(commitTimes); 
       scoreData[author] = {...authorData[author], scaledCommitCount: scaledCommitCount};
       scoreData[author]['score'] = (0.5*scaledCommitCount) + (0.3*linesAdded) + (0.2*linesDeleted);
    });

    // Sort the scores in descending order
    const sortedData: Record<string, ScoreData> = Object.entries(scoreData)
        .sort(([, a], [, b]) => b.score - a.score) // Sort by score in descending order
        .reduce((acc, [key, value]) => ({ ...acc, [key]: value }), {});


    return sortedData;


}

/**
 * Calculate a scaled commit count based on the timestamps of commits.
 * This attempts to count the number of "separate" commits that an author
 * has made. If two commits are within 30 minutes of each other, they are
 * counted as one commit. Otherwise, they are counted as two separate
 * commits.
 * @param commitTimes an array of timestamps (in seconds since the Unix epoch)
 * @returns the scaled commit count
 */
function getScaledCommitCount(commitTimes: number[]): number {
    if (commitTimes.length <= 1) {
        return commitTimes.length;
    }
    const sortedCommitTimes = commitTimes.sort((a, b) => a - b);

    let scaledCommits = 0;
    let lastCommitTime: number | null = null;

    for (const timestamp of sortedCommitTimes) {
        // If this is the first commit or it's more than 30 minutes from the last commit
        if (lastCommitTime === null || timestamp - lastCommitTime >= 30 * 60) {
            scaledCommits++; // Count this commit
            lastCommitTime = timestamp; // Update the last commit time
        }
    }

    return scaledCommits;
    
    
}

// const REPO_PATH = "/Users/adithya/Desktop/Developer/Uplimit/gitown/go"; // <-- Update this with the correct local path
// async function main(): Promise<void> {
//     const logData = await getGitLogStream('src/crypto/ecdsa',"https://github.com/golang/go.git");
//     const scoreData = calculateScores(logData);
//     const aggregateData = aggregateScores(scoreData);
//     console.log(aggregateData);
// }

// main(); 
//console.log(calculateScores(logData));