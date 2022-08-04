const slack_app_token = PropertiesService.getScriptProperties().getProperty("slack_app_token")
const slash_command_token = PropertiesService.getScriptProperties().getProperty("slash_command_token")
const spread_sheet_id = PropertiesService.getScriptProperties().getProperty('game_sheet_id')
const spread_sheet = SpreadsheetApp.openById(spread_sheet_id)

const STARTED = 0
const FIN_FORTUNE = 1
const FIN_WEREWOLF = 2
const FIN_LUPIN = 3

/**
 * スラッシュコマンドを受付
 * sub_commandをチェックして処理を振り分け。
 * スプレッドシートのA10セルでSTATUS管理
 */
const doPost = (event) => {
  console.log('doPost start')

  // トークンがSlashCommandのリクエストと一致する場合のみ処理
  if(event.parameter.token !== slash_command_token){
    result = `無効なトークンです`
    return ContentService.createTextOutput(result)
  }

  const params = event.parameter.text
  const param_list = params.split(' ')

  const request_user_id = event.parameter.user_id
  console.log('request user:' + request_user_id)
  console.log(param_list)
  if(param_list.length < 1){
    result = `引数が足りません`
    return ContentService.createTextOutput(result)
  }

  const sub_command = param_list[0]
  console.log(sub_command)
  param_list.shift()

  let result = ''

  switch(sub_command){
    case 'start':
      result = startGame(param_list)
      break;
    case 'vote':
      result = vote(param_list, request_user_id)
      break;
    case 'finish':
      result = finishGame(param_list)
      break;
    case 'fortune-teller':
      result = fortuneTeller(param_list, request_user_id)
      break;
    case 'lupin':
      result = lupin(param_list, request_user_id)
      break;
    case 'finish_fortune-teller':
      result = finishFortuneTeller(param_list)
      break;
    case 'finish_werewolf':
      result = finishWereWolf(param_list)
      break;
    case 'finish_lupin':
      result = finishLupin(param_list)
      break;
    case 'help':
      result = help(param_list)
      break;
    default:
      result = `定義されていないsub_command`
  }
  console.log('doPost end')
  if(result){
    postErrorMessage(request_user_id, result)
  }
  return ContentService.createTextOutput('')
}


/**
 * ヘルプ
 * ヘルプメッセージを返すだけ。
 */
const help = (param_list) => {
  text = 'ワンナイト人狼のコマンドです。ワンナイト人狼自体のルールに関しては以下を参照してください。\n'
  text += 'https://boku-boardgame.net/one-night-wereewolf\n'
  text += '公式のルールは以下からダウンロードできます。\n'
  text += 'https://commons.nicovideo.jp/material/nc63613\n'
  text += '\n'
  text += 'コマンド一覧\n'
  text += '```\n'
  text += '- /one_night_werewolf start @player1 @player2 @player3 ...\n'
  text += 'ゲームの開始。3人〜7人のプレイヤーをスペース区切りで指定する。参加プレイヤーとbotのDMが作成され、ゲームが開始されます。\n'
  text += '- /one_night_werewolf fortune-teller ゲームID @player \n'
  text += '占い師コマンド。対象のプレイヤーを指定すると、その役職を確認できる。プレイヤーではなくdummyを指定すると、あまりの2役職を確認できる。\n'
  text += '- /one_night_werewolf finish_fortune-teller ゲームID\n'
  text += '占い師のターン終了コマンド。botの指示に従って、10秒程度待ってから実行して次のターンに移ります。\n'
  text += '- /one_night_werewolf finish_werewolf ゲームID\n'
  text += '人狼のターン終了コマンド。botの指示に従って、10秒程度待ってから実行して次のターンに移ります。\n'
  text += '- /one_night_werewolf lupin ゲームID @player\n'
  text += '怪盗コマンド。対象のプレイヤーを指定すると、そのプレイヤーと役職を交換する。プレイヤーではなくdummyを指定すると、あまりの2役職からランダムで役職を交換する。\n'
  text += '- /one_night_werewolf finish_lupin ゲームID\n'
  text += '怪盗のターン終了コマンド。botの指示に従って、10秒程度待ってから実行して次のターンに移ります。\n'
  text += '- /one_night_werewolf vote ゲームID @player\n'
  text += '投票コマンド。対象のプレイヤーを指定して投票します。プレイヤー全員が投票を完了するとゲーム終了となります。\n'
  text += '- /one_night_werewolf finish ゲームID\n'
  text += 'ゲーム終了。\n'
  text += '- /one_night_werewolf help\n'
  text += 'ヘルプコマンド。本コマンド。\n'
  text += '```\n'
  return text
}


/**
 * ゲームの開始。
 * 役職を割り当て、スプレッドシートにシートを追加し状態を保持。
 */
const startGame = (param_list) => {
  console.log('startGame start')
  // パラメータチェック
  if(param_list.length < 3){
    result = `引数が足りません`
    return result
  }
  
  let player_list = []
  param_list.forEach(str => {
     player_list.push(str.slice(str.indexOf('@') + 1, str.indexOf('|')))
  })

  //プレイヤー数をチェック
  if(player_list.length > 8){
    result = `プレイヤーが多すぎます。`
    return result
  }
  if(player_list.length < 3){
    result = `プレイヤーが少なすぎます。`
    return result
  }

  //伏せカード分追加
  player_list.push('dummy', 'dummy')

  const shuffled_player = shuffle(player_list)

  //役職数と合わせるため、空文字を追加。スプレッドシートへの記入範囲を固定化するため。
  while(shuffled_player.length < 10){
    shuffled_player.push('')
  }

  //各役職にプレイヤーを割り当て、スプレッドシートに書き込み。
  let id = 1
  const sheet = spread_sheet.getSheetByName('template')
  const new_sheet = sheet.copyTo(spread_sheet)
  while(true){
    if(spread_sheet.getSheetByName(id)){
      id++
    }else{
      break
    }
  }
  new_sheet.setName(id)
  new_sheet.getRange('A2:J2').setValues([shuffled_player])
  //シートを初期化
  const init_value = [['', '', '', '', '', '', '', '', '', ''],['', '', '', '', '', '', '', '', '', '']]
  new_sheet.getRange('A3:J4').setValues(init_value)
  //プレイヤーに役職を通知
  let requests = []
  shuffled_player.forEach((player, index) => {
    if(player && player !== 'dummy'){
      const range = index2Alpha(index) + '1'
      const job = new_sheet.getRange(range).getValue()
      const message = getNoticeMessage(job, id)
      const request = createPostMessageRequest(player, message)
      requests.push(request)
    }
  })
  UrlFetchApp.fetchAll(requests)

  //参加者のDMを作成し、ゲームの開始を通知
  const users_list = player_list.filter(user => (user !== 'dummy'))
  const users = users_list.join()
  const channel_id = getChannelId(users)
  let message = "ワンナイト人狼を開始します。ゲームIDは\n`" + id + "`\nです。\n各サブコマンドの最初の引数にこのIDを指定してください。\n各プレイヤーに役職を通知しました。\nまずは占い師のターンです。占ってください。10秒程度で\n`/one_night_werewolf finish_fortune-teller " + id + "`\nを実行してください。"
  postMessage(channel_id, message)

  sheet.getRange('A10').setValue(STARTED)

  console.log('startGame end')
}


/**
 * 占い師
 * 対象の役職をスプレッドシートから取得し、コマンドを実行した占い師にDMで通知する。
 * 複数回実行されると困る。
 */
const fortuneTeller = (param_list, request_user_id) => {
  console.log('fortuneTeller start')
  if(param_list.length < 2){
    result = `引数が足りません`
    return result
  }

  const id = param_list[0]
  const sheet = spread_sheet.getSheetByName(id)
  if(!sheet){
    result = `ゲームIDが間違っています`
    return result
  }

  if(sheet.getRange('A10').getValue() !== STARTED){
    result = `占い師のターンは終わっています`
    return result
  }

  let target = ''
  if(param_list[1] === 'dummy'){
    target = param_list[1]
  }else{
    target = param_list[1].slice(param_list[1].indexOf('@') + 1, param_list[1].indexOf('|'))
  }

  const channel_id = getChannelId(request_user_id)
  const cells = sheet.getRange("A1:J3").getValues()

  let message = ''

  //占い師かチェック
  cells[1].forEach((value, index) => {
    if(value === request_user_id){
      if(cells[0][index] !== '占い師'){
        message = 'あなたは占い師ではありません。'
      }
    }
  })
  if(message){
    postMessage(channel_id, message)
    return
  }

  //対象の役職を取得
  let target_job = ''
  cells[1].forEach((value, index) => {
    if(value === target){
      if(target_job){
        target_job += ', '
      }
      target_job += cells[0][index]
    }
  })

  const target_name = getUserName(target)
  messge = target_name + 'の役職は' + target_job + 'です。'
  postMessage(channel_id, message)

  sheet.getRange('A10').setValue(FIN_FORTUNE)

  console.log('fortuneTeller end')
}


/**
 * 占い師のターン終了
 * 10秒程度空けて自動実行にしたいが、とりあえずコマンドで実施。複数回実行されても害はない。
 */
const finishFortuneTeller = (param_list) => {
  console.log('finishFortuneTeller start')
  if(param_list.length < 1){
    result = `引数が足りません`
    return result
  }

  const id = param_list[0]
  const sheet = spread_sheet.getSheetByName(id)
  if(!sheet){
    result = `ゲームIDが間違っています`
    return result
  }

  const values = sheet.getRange('B2:J2').getValues()
  const players = values[0]
  const users = players.filter(user => (user && user !== 'dummy')).join()
  const channel_id = getChannelId(users)
  let message = "占い師のターンが終了しました。次は人狼のターンです。人狼のプレイヤーに他の人狼のプレイヤーを通知します。10秒程度で\n`/one_night_werewolf finish_werewolf " + id + "`\nを実行してください。"
  postMessage(channel_id, message)

  //人狼に人狼のプレイヤーを通知
  let were_wolf = []
  const cells = sheet.getRange("A1:J3").getValues()

  let wolf_message = '人狼は、あなたを含め以下のプレイヤーです。\n'
  cells[0].forEach((value, index) => {
    if(value === '人狼'){
      if(cells[1][index] && cells[1][index] !== 'dummy'){
        were_wolf.push(cells[1][index])
      }
    }
  })

  were_wolf.forEach((wolf) => {
    wolf_message += getUserName(wolf) + '\n'
  })

  were_wolf.forEach((wolf) => {
    const channel_id = getChannelId(wolf)
    postMessage(channel_id, wolf_message)
  })

  if(sheet.getRange('A10').getValue() < FIN_FORTUNE){
    sheet.getRange('A10').setValue(FIN_FORTUNE)
  }
  console.log('finishFortuneTeller end')
}


/**
 * 人狼のターン終了
 * 10秒程度空けて自動実行にしたいが、とりあえずコマンドで実施。複数回実行されても害はない。
 */
const finishWereWolf = (param_list) => {
  console.log('finishWereWolf start')
  if(param_list.length < 1){
    result = `引数が足りません`
    return result
  }

  const id = param_list[0]
  const sheet = spread_sheet.getSheetByName(id)
  if(!sheet){
    result = `ゲームIDが間違っています`
    return result
  }

  if(sheet.getRange('A10').getValue() < FIN_FORTUNE){
    result = `人狼のターンはまだです`
    return result
  }

  const values = sheet.getRange('B2:J2').getValues()
  const players = values[0]
  const users = players.filter(user => (user !== 'dummy')).join()
  const channel_id = getChannelId(users)
  const message = "人狼のターンが終了しました。次は怪盗のターンです。怪盗は誰かの心を盗んでください。盗まなくても良いです。10秒程度で\n`/one_night_werewolf finish_lupin " + id + "`\nを実行してください。"
  postMessage(channel_id, message)
  if(sheet.getRange('A10').getValue() < FIN_WEREWOLF){
    sheet.getRange('A10').setValue(FIN_WEREWOLF)
  }
  console.log('finishWereWolf end')
}


/**
 * 怪盗
 */
const lupin = (param_list, request_user_id) => {
  console.log('lupin start')
  if(param_list.length < 2){
    result = `引数が足りません`
    return result
  }

  const id = param_list[0]
  const sheet = spread_sheet.getSheetByName(id)
  if(!sheet){
    result = 'ゲームIDが間違っています'
    return result
  }

  if(sheet.getRange('A10').getValue() < FIN_WEREWOLF){
    result = '怪盗のターンはまだです'
    return result
  }else if(sheet.getRange('A10').getValue() > FIN_LUPIN){
    result = '怪盗のターンは終わっています'
    return result
  }

  let target = ''
  if(param_list[1] === 'dummy'){
    target = param_list[1]
  }else{
    target = param_list[1].slice(param_list[1].indexOf('@') + 1, param_list[1].indexOf('|'))
  }

  const channel_id = getChannelId(request_user_id)
  const cells = sheet.getRange("A1:J3").getValues()

  let message = ''
  //怪盗かチェック
  cells[1].forEach((value, index) => {
    if(value === request_user_id){
      if(cells[0][index] !== '怪盗'){
        message = 'あなたは怪盗ではありません。'
      }
    }
  })
  if(message){
    postMessage(channel_id, message)
    return
  }

  //対象と入れ替え
  //対象がプレイヤーなら、単純に入れ替え。dummyなら、ランダムでどちらかと入れ替え。
  const random = Math.floor( Math.random() * 2 );
  sheet.getRange('E2').setValue(target)
  let new_job = ''
  for(let i = 0; i < 10; i ++){
    if(i === 4){
      continue
    }
    const col = index2Alpha(i)
    if(sheet.getRange(col + '2').getValue() === target){
      if(target === 'dummy' && random || target !== 'dummy'){
        sheet.getRange(col + '2').setValue(request_user_id)
        new_job = sheet.getRange(col + '1').getValue()
        break
      }else{
        random += 1
      }
    }
  }

  messge = 'あなたの新しい役職は' + new_job + 'です。'
  postMessage(channel_id, message)
  sheet.getRange('A10').setValue(FIN_LUPIN)
  console.log('lupin end')
}


/**
 * 怪盗のターン終了
 */
const finishLupin = (param_list) => {
  console.log('finishLupin start')
  if(param_list.length < 1){
    result = `引数が足りません`
    return result
  }

  const id = param_list[0]
  const sheet = spread_sheet.getSheetByName(id)
  if(!sheet){
    result = 'ゲームIDが間違っています'
    return result
  }

  if(sheet.getRange('A10').getValue() < FIN_WEREWOLF){
    result = '怪盗のターンはまだです'
    return result
  }

  const values = sheet.getRange('B2:J2').getValues()
  const players = values[0]
  const users = players.filter(user => (user !== 'dummy')).join()
  const channel_id = getChannelId(users)
  const message = "怪盗のターンが終了しました。それでは、投票のために話し合ってください。3分程度で各プレイヤーは\n`/one_night_werewolf vote " + id + " @player`\nで投票を実行してください。"
  postMessage(channel_id, message)

  if(sheet.getRange('A10').getValue() < FIN_LUPIN){
    sheet.getRange('A10').setValue(FIN_LUPIN)
  }

  console.log('finishLupin end')
}


/**
 * 投票
 */
const vote = (param_list, request_user_id) => {
  console.log('vote start')
  if(param_list.length < 2){
    result = `引数が足りません`
    return result
  }

  const id = param_list[0]
  const sheet = spread_sheet.getSheetByName(id)
  if(!sheet){
    result = 'ゲームIDが間違っています'
    return result
  }

  if(sheet.getRange('A10').getValue() < FIN_LUPIN){
    result = 'まだ投票できません'
    return result
  }

  //vote済チェック
  const cells = sheet.getRange("A1:J4").getValues()
  let isVoted = 0
  cells[1].forEach((value, index) => {
    if(value === request_user_id){
      isVoted = cells[3][index]
    }
  })
  if(isVoted){
    result = `vote済みです`
    return result
  }
  
  const target = param_list[1].slice(param_list[1].indexOf('@') + 1, param_list[1].indexOf('|'))
  const players = cells[1]
  players.forEach((player, index) => {
    if(player === target){
      const range = index2Alpha(index) + '3'
      sheet.getRange(range).setValue(sheet.getRange(range).getValue() + 1)
    }
    if(player === request_user_id){
      const range = index2Alpha(index) + '4'
      sheet.getRange(range).setValue(1)
    }
  })

  const player_count = players.filter(user => (user && user !== 'dummy')).length
  const vote_values = sheet.getRange('A3:J3').getValues()[0]
  let sum_vote = 0
  let max_vote = 0
  let voted_index = 0
  vote_values.forEach((value, index) => {
    value = Number(value)
    sum_vote += value
    if(value > max_vote){
      max_vote = value
      voted_index = index
    }
  })

  let message = ""
  if(sum_vote >= player_count){
    message = '全員のvoteが終了しました。役職、投票結果は以下の通りです。\n'
    cells[0].forEach((value, index) => {
      if(cells[1][index]){
        message += value + " : " + getUserName(cells[1][index]) + " : " + vote_values[index] +"\n"
      }
    })
    const users = players.filter(user => (user !== 'dummy')).join()
    const channel_id = getChannelId(users)
    postMessage(channel_id, message)
  }
  console.log('vote end')
}


/**
 * 通知メッセージの取得
 */
const getNoticeMessage = (job, id) => {
  let message = ''
  switch(job){
    case '村人':
    case '人狼':
    case '狂人':
      message = 'あなたの役職は' + job + 'です。'
      break
    case '占い師':
      message = 'あなたの役職は' + job + 'です。\n指示が来たら、\n`/one_night_werewolf fortune-teller ' + id + ' @player(or dummy)`\nで占いを実行してください。dummyを占うと、余りの2つの役職が占えます。'
      break
    case '怪盗':
      message = 'あなたの役職は' + job + 'です。\n指示が来たら、\n`/one_night_werewolf lupin ' + id + ' @player(or dummy)`\nで相手の心を盗んでください。役職が入れ替わります。dummyを選択した場合、余りの2つの役職のうちどちらとランダムで入れ替わります。'
      break
  }
  return message
}


/**
 * メッセージ送信リクエストの生成
 */
const createPostMessageRequest = (player, message) => {
  const channel_id = getChannelId(player)
  const request = {
    "url" : 'https://slack.com/api/chat.postMessage',
    "method" : "post",
    "contentType": "application/x-www-form-urlencoded",
    "payload" : {
      "token": slack_app_token,
      "channel": channel_id,
      "text": message
    }
  }
  return request
}

const index2Alpha = (index) => {
  const base = `A`.charCodeAt(0)
  target = base + index
  return String.fromCharCode(target)
}

const finishGame = (param_list) => {
  // パラメータチェック
  if(param_list.length < 1){
    result = `引数が足りません`
    return result
  }
  const id = param_list[0]
  spread_sheet.deleteSheet(spread_sheet.getSheetByName(id))
}

const shuffle = ([...array]) => {
  for (let i = array.length - 1; i >= 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [array[i], array[j]] = [array[j], array[i]];
  }
  return array;
}

const postErrorMessage = (request_user, message) => {
  const channel_id = getChannelId(request_user)
  postMessage(channel_id, message)
}

const postMessage = (channel_id, message) => {
  const options = {
    "method" : "post",
    "contentType": "application/x-www-form-urlencoded",
    "payload" : {
      "token": slack_app_token,
      "channel": channel_id,
      "text": message
    }
  }
  
  //必要scope = chat:write
  const message_url = 'https://slack.com/api/chat.postMessage';
  const response = UrlFetchApp.fetch(message_url, options);
  const obj = JSON.parse(response);
  if(!obj.ok){
    console.log(obj);
  }
}

const getChannelId = (users) => {
  const options = {
    "method" : "post",
    "contentType": "application/x-www-form-urlencoded",
    "payload" : {
      "token": slack_app_token,
      "users": users
    }
  }
  
  //必要scope = im:write
  const url = 'https://slack.com/api/conversations.open';
  const response = UrlFetchApp.fetch(url, options);
  
  const obj = JSON.parse(response);
  if(!obj.ok){
    console.log(obj);
  }
  
  return obj.channel.id;
}

const getUserName = (user) => {
  if(!user || user === 'dummy'){
    return user
  }
  const options = {
    "method" : "get",
    "contentType": "application/x-www-form-urlencoded",
    "payload" : {
      "token": slack_app_token,
      "user": user
    }
  }
  
  //必要scope = im:write
  const url = 'https://slack.com/api/users.info'
  const response = UrlFetchApp.fetch(url, options)
  
  const obj = JSON.parse(response);

  if(!obj.ok){
    console.log(obj);
    return 'エラー！'
  }
  
  return obj.user.profile.display_name;
}

