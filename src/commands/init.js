import inquirerAsync from 'inquirer-async';
import ProgressBar from 'progress';
import {
  Api,
  Exp,
  Logger,
  NotificationCode,
  MessageCode,
} from 'xdl';

import _ from 'lodash';
import log from '../log';

let _currentRequestID = 0;
let _downloadIsSlowPrompt = false;
let _retryObject = {};

async function action(projectDir, options) {
  let validatedOptions = {};
  let templateType;
  let questions = [];

  if (options.projectName) {
    validatedOptions.name = options.projectName;
  } else {
    questions.push({
      type: 'input',
      name: 'name',
      message: 'Project name',
      validate(val) {
        // TODO: Validate
        return val.length > 0;
      },
    });
  }

  if (options.projectType) {
    templateType = options.projectType;
  } else {
    let versions = await Api.versionsAsync();
    let templateIds = _.map(versions.templates, (template) => `"${template.id}"`);

    questions.push({
      type: 'input',
      name: 'type',
      message: `Project type. Options are: ${templateIds.join(', ')}`,
      validate(val) {
        for (let i = 0; i < versions.templates.length; i++) {
          if (versions.templates[i].id === val) {
            return true;
          }
        }
        return false;
      },
    });
  }

  if (questions.length > 0) {
    var answers = await inquirerAsync.promptAsync(questions);
    if (answers.name) {
      validatedOptions.name = answers.name;
    }
    if (answers.type) {
      templateType = answers.type;
    }
  }
  downloadAndExtractTemplate(templateType, projectDir, validatedOptions);
}

async function downloadAndExtractTemplate(templateType, projectDir, validatedOptions) {
  _retryObject = {templateType, projectDir, validatedOptions};
  const requestID = _currentRequestID + 1;
  _currentRequestID = requestID;
  let templateDownload = await Exp.downloadTemplateApp(templateType, projectDir,
    {...validatedOptions,
      progressFunction: (progress) => {
        const percent = Math.round(progress * 100);
        if (_currentRequestID === requestID) {
          Logger.notifications.info({code: NotificationCode.DOWNLOAD_CLI_PROGRESS}, percent + '%');
          const bar = new ProgressBar('[:bar] :percent', { total: 100, complete: '=', incomplete: ' ' });
          if (!_downloadIsSlowPrompt) {
            bar.tick(percent);
          }
        }
      },
      retryFunction: () => {
        triggerRetryPrompt();
      }});

  // Since we cannot cancel the download request, we need a way to ignore all of the requests made except the last one when retrying.
  if (_currentRequestID !== requestID) {
    return;
  }
  let root = await Exp.extractTemplateApp(templateDownload.starterAppPath, templateDownload.name, templateDownload.root);
  log(`Your project is ready at ${root}. Use "exp start ${root}" to get started.`);
  process.exit();
}

async function triggerRetryPrompt() {
  _downloadIsSlowPrompt = true;
  var answer = await inquirerAsync.promptAsync({type:'input', name: 'retry', message: '\n' + MessageCode.DOWNLOAD_IS_SLOW + '(y/n)',
    validate(val) {
      if (val !== 'y' && val !== 'n') {
        return false;
      }
      return true;
    },
  });

  if (answer.retry === 'n') {
    _downloadIsSlowPrompt = false;
  } else {
    Exp.clearXDLCacheAsync();
    _downloadIsSlowPrompt = false;
    downloadAndExtractTemplate(_retryObject.templateType, _retryObject.projectDir, _retryObject.validatedOptions);
  }
}

export default (program) => {
  program
    .command('init [project-dir]')
    .alias('i')
    .description('Initializes a directory with an example project. Run it without any options and you will be prompted for the name and type.')
    .option('-n, --projectName [name]', 'Specify a name for the new project')
    .option('-t, --projectType [type]', 'Specify what type of template to use. Run without this option to see all choices.')
    .allowNonInteractive()
    .asyncActionProjectDir(action, true); // pass true to skip validation
};
