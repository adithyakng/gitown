#!/usr/bin/env ts-node

import { spawn, execSync } from 'child_process';
import { Command } from 'commander';

const program = new Command();


/**
 * The shape of the data for each author, as collected from the repository.
 */
interface AuthorData {
    /**
     * The number of commits made by this author.
     */
    commitCount: number;
    /**
     * A list of timestamps (in seconds since the Unix epoch) for when this author made
     * commits.
     */
    commitTimes: number[];
    /**
     * The total number of lines added by this author.
     */
    linesAdded: number;
    /**
     * The total number of lines deleted by this author.
     */
    linesDeleted: number;
    /**
     * The score for this author, as calculated by the `aggregateScores` function.
     */
    score: number;
}


/**
 * The shape of the data for each author, as returned by the `aggregateScores` function.
 * Extends `AuthorData` with an additional `scaledCommitCount` property.
 */
interface ScoreData extends AuthorData {
    /**
     * The scaled commit count for this author.
     * This is a measure of how many "separate" commits an author has made,
     * taking into account the timestamps of the commits.
     */
    scaledCommitCount: number;
}


const DEFAULT_REPO_URL = 'https://github.com/golang/go';
const DEFAULT_DIRECTORY = '.';
const DEFAULT_TOP_N = 3;

/**
 * A command line utility to get the top experts/contributors
 * 
 * Provides a table of the top contributors to the given repository
 * based on the number of lines added/changed.
 * 
 * @package gitown
 * @author Adithya Koti <adithyakng@gmail.com>
 */
program
    .version('1.0.0')
    .description('Get top N authors based on scores')
    .option('-r, --repo <url>', 'Repository HTTPS link', DEFAULT_REPO_URL)
    .option('-d, --directory <path>', 'Directory path', DEFAULT_DIRECTORY)
    .argument('[number]', 'Number of top authors to return', DEFAULT_TOP_N)
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

        let randomDir;
        try{
            // Create a temporary directory
            randomDir = Math.random().toString(36).substring(2, 15);
            execSync(`mkdir ${randomDir}`);

            // Git Clone
            console.log("Starting git clone...");
            cloneGitRepo(repoUrl,randomDir);
            console.log("Git Clone Completed.");

            // Analysis
            console.log("Starting Analysis...");

            // First get the git log
            const logData = await getGitLogStream(directory,randomDir);

            // Then aggregate the data
            const scoreData = aggregateData(logData);

            // Then calculate the scores to rank the authors
            const finalData = aggregateScores(scoreData);
            
            // Finally print the results
            prettyPrint(topNumber, finalData);
        }catch(e){
            console.error("Repository clone failed");
            return;
        }
        finally{
            if(randomDir)
                execSync(`rm -rf ${randomDir}`);
        }
    });


program.parse(process.argv);

/**
 * Clone a git repository to a specified directory
 * @param repoUrl The URL of the repository to clone
 * @param randomDir The directory to clone the repository into
 */
function cloneGitRepo(repoUrl: string, randomDir: string): void {
    execSync(`git -C ${randomDir} clone ${repoUrl} .`);
}

/**
 * Function to get git log details for a specific directory, including lines added/changed
 * 
 * @param directory The directory to get the git log for
 * @param REPO_PATH The path to the cloned repository
 * @returns A promise that resolves with the git log string
 */
function getGitLogStream(directory: string, REPO_PATH: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const logData: string[] = [];
      const gitLog = spawn('git', [
        '-C',
        REPO_PATH,
        'log',
        '--pretty=format:%ae %at', // Format the output to include author email and timestamp
        '--numstat', // Include the number of lines added/deleted
        '--no-merges', // Exclude merge commits
        '--', // Separate the options from the directory
        directory,
      ]);
  
      // Handle the output of the git log command
      gitLog.stdout.on('data', (data) => {
        logData.push(data.toString());
      });
  
      // Handle any errors with the git log command
      gitLog.stderr.on('data', (data) => {
        console.error(`Error: ${data}`);
      });
  
      // Handle the exit of the git log command
      gitLog.on('close', (code) => {
        if (code === 0) {
          resolve(logData.join(''));
        } else {
          reject(new Error(`git log process exited with code ${code}`));
        }
      });
    });
}


    /**
     * Aggregate the commit counts, lines added, and lines deleted for each author.
     * This function takes the output of `git log --pretty=format:%ae %at --numstat --no-merges -- <directory>`
     * and aggregates the data for each author. It returns an object mapping each author to their
     * aggregated data.
     * @param logData The output of `git log --pretty=format:%ae %at --numstat --no-merges -- <directory>`
     * @returns An object mapping each author to their aggregated data
     */
function aggregateData(logData: string): Record<string, AuthorData> {
    const authorData: Record<string, AuthorData> = {};

    let currentAuthor: string | null;
    // Split the log data into individual commit lines
    logData
        .split('\n')
        .forEach(line => {
            // Identify the author and timestamp for each commit
            if (line.includes('@')) {
                const [author, timestamp] = line
                    .split(/ (?=\d{10})/); // Split based on the timestamp (10-digit UNIX time)
                currentAuthor = author;

                // If the author is not already in the author data object, add it
                if (!authorData[currentAuthor]) {
                    authorData[currentAuthor] = {
                        commitCount: 0,
                        commitTimes: [],
                        linesAdded: 0,
                        linesDeleted: 0,
                        score: 0,
                    };
                }

                // Increment the commit count for the current author
                authorData[currentAuthor].commitCount += 1;

                // Add the commit timestamp to the current author's commit times
                authorData[currentAuthor].commitTimes.push(
                    parseInt(timestamp),
                );
            } else if (currentAuthor && line.trim()) {
                // Process the lines added and deleted from the numstat output
                const [added, deleted] = line.split('\t');
                const linesAdded =
                    added === '-' ? 0 : parseInt(added);
                const linesDeleted =
                    deleted === '-' ? 0 : parseInt(deleted);

                // Increment the lines added and deleted for the current author
                authorData[currentAuthor].linesAdded += linesAdded;
                authorData[currentAuthor].linesDeleted += linesDeleted;
            }
        });

    return authorData;
}

    /**
     * Aggregates the commit counts, lines added, and lines deleted
     * for each author and calculates a score for each author.
     * The score is a weighted sum of the commit count, lines added,
     * and lines deleted. The weights are 0.5, 0.3, and 0.2 respectively.
     * The scores are then sorted in descending order and returned
     * as a Record<string, ScoreData>.
     * @param authorData a Record<string, AuthorData> containing the commit
     * counts, lines added, and lines deleted for each author.
     * @returns a Record<string, ScoreData> with the aggregated scores
     * for each author, sorted in descending order.
     */
function aggregateScores(authorData: Record<string, AuthorData>): Record<string, ScoreData> {
    const scoreData: Record<string, ScoreData> = {};

    // Iterate over each author in the authorData object
    Object.keys(authorData).forEach((author) => {
        const {commitTimes, linesAdded, linesDeleted } = authorData[author];

        // Calculate a scaled commit count based on the timestamps of commits
        const scaledCommitCount = getScaledCommitCount(commitTimes);

        // Create a new ScoreData object for the current author
        scoreData[author] = {...authorData[author], scaledCommitCount: scaledCommitCount};

        // Calculate the score for the current author
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

    // Sort the commit times in ascending order
    const sortedCommitTimes = commitTimes.sort((a, b) => a - b);

    let scaledCommits = 0;
    let lastCommitTime: number | null = null;

    // Iterate over the sorted commit times
    for (const timestamp of sortedCommitTimes) {
        // If this is the first commit or it's more than 30 minutes from the last commit
        if (lastCommitTime === null || timestamp - lastCommitTime >= 30 * 60) {
            // Count this commit
            scaledCommits++;
            // Update the last commit time
            lastCommitTime = timestamp;
        }
    }

    return scaledCommits;
    
    
}

    /**
     * Prints the top topNumber authors to the console in a table format.
     * If there are no authors found, it prints a message indicating that.
     * @param topNumber the number of top authors to print
     * @param aggregateData the aggregate data that contains the scores for each author
     */
    function prettyPrint(topNumber: number, aggregateData: Record<string, ScoreData>): void {
        if(aggregateData === null || Object.keys(aggregateData).length === 0){
            console.log("-----------No authors found.---------------");
            return;
        }

        // Map the aggregate data to a table format
        const tableData = Object.entries(aggregateData).map(([email, authorData], index) => ({
            // Rank of the author
            Rank: index + 1,
            // Email of the author
            Email: email,
            // Commit count of the author
            CommitCount: authorData.commitCount,
            // Scaled commit count of the author
            ScaledCommitCount: authorData.scaledCommitCount,
            // Lines added by the author
            LinesAdded: authorData.linesAdded,
            // Lines deleted by the author
            LinesDeleted: authorData.linesDeleted,
            // Score of the author
            Score: authorData.score.toFixed(1)
        }))
        // Get only the top topNumber entries
        .slice(0, topNumber);

        // Print the table
        console.table(tableData);
    }
