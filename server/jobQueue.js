const Queue = require("bull");
const Job = require("./models/Job");
const { executeCpp } = require("./executeCpp");
const Problem = require("./models/Problem");
const { executePy } = require("./executePy");

const jobQueue = new Queue("job-queue", {
  redis: { host: "redis", port: 6379 },
});

async function executeJob(job) {
  const userInput = job.userInput;
  job = job._doc;
  if (job.language === "cpp" || job.language === "c") {
    return executeCpp(job.filepath, userInput || "");
  } else {
    return executePy(job.filepath, userInput || "");
  }
}

async function checkTestcases(job, testcases) {
  for (const testcase of testcases) {
    const output = await executeJob({ ...job, userInput: testcase.input });
    if (output.trim() !== testcase.output.trim()) return false;
  }
  return true;
}

function updateProblemSolvers(problem, userId) {
  const distinctUsers = new Set(problem.whoSolved);
  distinctUsers.add(userId);
  problem.whoSolved = [...distinctUsers];
  return problem.save();
}

async function processSubmission(job) {
  const problem = await Problem.findById(job.problemId);
  if (!problem) throw new Error(`Cannot find problem with id ${job.problemId}`);

  const passed = await checkTestcases(job, problem.testcase);
  job.verdict = passed ? "ac" : job.verdict || "wa";
  if (passed) updateProblemSolvers(problem, job.userId);
}

async function processJob(jobId) {
  const job = await Job.findById(jobId);
  if (!job) throw new Error(`Cannot find job with id ${jobId}`);

  job.startedAt = new Date();
  try {
    if (job.problemId) {
      await processSubmission(job);
    } else {
      job.output = await executeJob(job);
    }

    job.completedAt = new Date();
    job.status = "success";
  } catch (err) {
    job.completedAt = new Date();
    job.status = "error";
    job.output = err.message;
  } finally {
    await job.save();
  }
}

jobQueue.process(async ({ data }) => {
  await processJob(data.id);
});

jobQueue.on("failed", (error) => {
  console.error(`Job ${error.data.id} failed: ${error.failedReason}`);
});

module.exports = {
  addJobToQueue: async (jobId) => {
    await jobQueue.add({ id: jobId });
  },
  addSubmitToQueue: async (jobId, problemId, userId) => {
    const job = await Job.findById(jobId);
    if (!job) throw new Error(`Cannot find job with id ${jobId}`);
    Object.assign(job, { problemId, userId });
    await job.save();
    await jobQueue.add({ id: jobId });
  },
};
