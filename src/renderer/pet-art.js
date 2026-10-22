// 클마고치 도트 — 위젯(index.html)과 미리보기 시트(app/pet-sheet.cjs)가 같이 쓴다.
// 문자 하나 = 도트 한 칸, '.' = 투명. 줄 길이가 달라도 그릴 때 오른쪽을 채운다.
(function (root) {
  const PAL = {
    B: '#d97757', E: '#1f1e1d', K: '#9aa0a8', k: '#6c727a', P: '#f783ac', p: '#ffc9d9', Y: '#fcd34d',
    O: '#ff922b', W: '#f1f3f5', w: '#c5d3e8', G: '#69db7c', g: '#37b24d', V: '#b197fc', v: '#845ef7',
    C: '#f3e6cc', S: '#e8a87c', L: '#74c0fc', R: '#ff6b6b', N: '#5c7cfa', D: '#a9714b', T: '#38d9a9', F: '#f76a2c',
    H: '#a9e34b', h: '#82c91e', M: '#40c057', m: '#2b8a3e', // 연두 · 초록 (슬라임 성장)
  };

  const EGG = ['...CCC...', '..CCCCC..', '.CCSCCCC.', '.CCCCCSC.', 'CCCCCCCCC', 'CCECCECCC', 'CSCCCCCCC', '.CCCCCSC.', '..CCCCC..'];

  // [이름, 아기, 어린이, 어른]
  const SPECIES = [
    ['Clawd',
      ['.BBBBB.', '.BEBEB.', 'BBBBBBB', '.BBBBB.', '.B.B.B.'],
      ['..BBBBBBB..', '..BEBBBEB..', '..BEBBBEB..', 'BBBBBBBBBBB', 'BBBBBBBBBBB', '..BBBBBBB..', '..B.B.B.B..', '..B.B.B.B..'],
      ['...BBBBBBB...', '..BBBBBBBBB..', '..BBEBBBEBB..', '..BBEBBBEBB..', 'BBBBBBBBBBBBB', 'BBBBBBBBBBBBB', '..BBBBBBBBB..', '..BBBBBBBBB..', '..B.B.B.B.B..', '..B.B.B.B.B..']],
    ['고양이',
      ['K.....K', 'KK...KK', 'KKKKKKK', 'KEKKKEK', 'KKKPKKK', '.KKKKK.', '.K...K.'],
      ['.K.......K.', '.KK.....KK.', '.KKKKKKKKK.', '.KEKKKKKEK.', '.KKKKPKKKK.', '.KkKKKKKkK.', '..KKKKKKK..', '..K.K.K.K..'],
      ['.K.......K...', '.KK.....KK...', '.KKKKKKKKK...', '.KEKKKKKEK...', '.KKKKPKKKK...', '.KkKKKKKkK..K', '..KKKKKKKK.K.', '..KkKkKkKKK..', '..KKKKKKKK...', '..K.K..K.K...']],
    ['병아리',
      ['..YYY..', '.YEYEY.', '.YYOYY.', 'YYYYYYY', 'CCCCCCC', '.CSCSC.'],
      ['....YYY....', '...YYYYY...', '..YEYYYEY..', '..YYYOOYY..', '.YYYYYYYYY.', 'YYYYYYYYYYY', '..YYYYYYY..', '...O...O...'],
      ['.....RR......', '....RRR......', '...WWWWW.....', '..WEWWWW.....', '..WWWWOOO....', '...RWWWWW..W.', '...WWWWWWWWW.', '..WWWWWWWWWW.', '...WWWWWWWW..', '....WWWWW....', '.....O..O....', '....OO.OO....']],
    ['문어',
      ['.VVVVV.', 'VVEVEVV', 'VVpVpVV', '.VVVVV.', 'V.V.V.V'],
      ['...VVVVV...', '..VVVVVVV..', '.VVEVVVEVV.', '.VVpVVVpVV.', '.VVVVVVVVV.', '.V.V.V.V.V.', 'V..V.V.V..V', '...v...v...'],
      ['....VVVVV....', '..VVVVVVVVV..', '.VVVvVVVVvVV.', '.VVEEVVVEEVV.', '.VVVVVVVVVVV.', '.VVpVVVVVpVV.', '..VVVVVVVVV..', '.V.V.V.V.V.V.', 'V..V.V.V.V..V', 'V.V..V.V..V.V', '.V..v...v..V.']],
    ['유령',
      ['.WWWWW.', 'WWEWEWW', 'WWWWWWW', 'WWWwWWW', 'W.W.W.W'],
      ['...WWWWW...', '..WWWWWWW..', '.WWEWWWEWW.', '.WWEWWWEWW.', '.WWWWwWWWW.', '.WWWWWWWWW.', '.WWWWWWWWW.', '.W.WW.WW.W.'],
      ['....WWWWW....', '..WWWWWWWWW..', '.WWWWWWWWWWW.', '.WWWEWWWEWWW.', 'WWWWEWWWEWWWW', 'WWpWWWWWWWpWW', 'WWWWWWWWWWWWW', '.WWWWWWWWWWWW', '.WWWWWWWWWWW.', '.WW.WWW.WWW.W', '.W...W...W...']],
    ['슬라임',
      ['...h...', '..HHH..', '.HEHEH.', 'HHHHHHH', 'hhhhhhh'],
      ['.....h.....', '....HHH....', '...HHHHH...', '..HHWHHHH..', '.HHEHHHEHH.', '.GGGGGGGGG.', 'GGGGGGGGGGG', '.gggggggggg'],
      // 어른: 눈 왼쪽 위 흰 점이 반짝이
      ['....Y.Y.Y....', '....YYYYY....', '...MMMMMMM...', '..MMMMMMMMM..', '.MMMMMMMMMMM.', '.MMWEMMMWEMM.', 'MMMEEMMMEEMMM', 'MMMMMMMMMMMMM', 'MMMMMMRRMMMMM', '.mmmmmmmmmmm.']],
    ['토끼',
      ['.p...p.', '.p...p.', 'WWWWWWW', 'WEWWWEW', 'WWpPpWW', '.WWWWW.'],
      ['..p.....p..', '..Wp...pW..', '..Wp...pW..', '.WWWWWWWWW.', '.WEWWWWWEW.', '.WWpWPWpWW.', '..WWWWWWW..', '..W.W.W.W..'],
      ['..Wp.....pW..', '..Wp.....pW..', '..Wp.....pW..', '..WW.....WW..', '.WWWWWWWWWWW.', '.WWEWWWWWEWW.', '.WWWpWPWpWWW.', '..WWWWWWWWW..', '.WWWWWWWWWWg.', '.WWWWWWWWWOO.', '..WW....WWO..']],
    ['개구리',
      ['.GGG...', 'GEGEG..', 'GGGGGgg', '.GGG..g'],
      ['.WW.....WW.', '.WE.....WE.', '.GGGGGGGGG.', 'GGGGGGGGGGG', 'GGRRRRRRRGG', '.GGGGGGGGG.', '..gGGGGGg..', '.g.g...g.g.'],
      ['.WWW.....WWW.', '.WEW.....WEW.', '.GGGGGGGGGGG.', 'GGGGGGGGGGGGG', 'GGGGGGGGGGGGG', 'GGRRRRRRRRRGG', '.GGGGGGGGGGG.', '.GGgGGGGGgGG.', '..GGGGGGGGG..', '.gg.g...g.gg.']],
    ['펭귄',
      ['.KKKKK.', 'KKEKEKK', 'KKWOWKK', 'KKWWWKK', '.KKKKK.', '..O.O..'],
      ['...NNNNN...', '..NNNNNNN..', '.NNWEWEWNN.', '.NNWWOWWNN.', 'NNNWWWWWNNN', '.NNWWWWWNN.', '..NWWWWWN..', '...OO.OO...'],
      ['....NNNNN....', '...NNNNNNN...', '..NNWEWEWNN..', '..NNWWOWWNN..', '.NNYWWWWWYNN.', 'NNNWWWWWWWNNN', '.NNWWWWWWWNN.', '.NNWWWWWWWNN.', '..NWWWWWWWN..', '...NNNNNNN...', '...OOO.OOO...']],
    ['곰',
      ['D.....D', 'DDDDDDD', 'DEDDDED', 'DDCCCDD', 'DDCECDD', '.DDDDD.'],
      ['.DD.....DD.', '.DDDDDDDDD.', '.DEDDDDDED.', '.DDDCCCDDD.', '.DDDCECDDD.', '..DDDDDDD..', '.DDDDDDDDD.', '..DD...DD..'],
      ['.DD.......DD.', '.DDDDDDDDDDD.', '.DDEDDDDDEDD.', '.DDDDCCCDDDD.', '.DDDDCECDDDD.', '..DDDDDDDDD..', '.DDDDCCCDDDDD', 'DDDDCCCCCDDYY', 'DDDDCCCCCDDYY', '.DDDDDDDDDD..', '..DDD...DDD..']],
    ['공룡',
      ['...TTT.', '..TETT.', '.OTTT..', 'TTTTT..', '.T.T...'],
      ['......TTTT.', '.....TETTT.', '..O..TTTTT.', '.TOO.TTT...', '.TTTTTTTT..', '..TTTTTTT..', '...TTTTT...', '...T...T...'],
      ['.......TTTTT.', '......TTETTTT', '......TTTTTTT', '..O...TTTWWW.', '.OOO.TTTT....', 'OTTTTTTTTTT..', '.TTTTTTTTTT..', '..TTTTTTTT...', '...TTTTTT....', '...TT..TT....', '..TTT..TTT...']],
    ['돼지',
      ['pp...pp', 'ppppppp', 'pEpppEp', 'ppPPPpp', 'ppPpPpp', '.ppppp.'],
      ['.pp.....pp.', '.ppppppppp.', '.pEpppppEp.', '.ppppppppp.', '.pppPPPppp.', '.pppPpPppp.', '..ppppppp..', '..p.p.p.p..'],
      ['.pp.......pp.', '.ppppppppppp.', '.ppEpppppEpp.', '.ppppppppppp.', '.pppPPPPPppp.', '.pppPEpEPpppP', '.pppPPPPPppP.', '.pppppppppppP', '..ppppppppp..', '..pp..p..pp..']],
    ['여우',
      ['F.....F', 'FF...FF', 'FFFFFFF', 'FEFFFEF', 'FWWEWWF', '.FWWWF.'],
      ['.F.......F.', '.FF.....FF.', '.FFFFFFFFF.', '.FEFFFFFEF.', '.FFWWWWWFF.', '..FWWEWWF..', '...FFFFF...', '..F.F.F.F..'],
      ['.F.......F...', '.FF.....FF...', '.FFFFFFFFF...', '.FEFFFFFEF...', '.FFWWWWWFF..F', '..FWWEWWF..FF', '...FFFFF..FFF', '..FFFFFFFFFFW', '..FWWWWWFFFW.', '..FFFFFFF.W..', '..F.F..F.F...']],
    ['복어',
      ['..LLL...', '.LLLELLL', 'LLLLLLL.', '.LwwwLLL', '..LLL...'],
      ['...LLLL....', '..LLLLLL..L', '.LLLLELLLLL', 'LLLLLLLLLLL', '.LLwwwwLLLL', '..LLLLLL..L', '...LLLL....'],
      ['..L..L..L....', 'L.LLLLLLL.L..', '.LLLLLLLLLL..', 'LLLLLLLLELLLL', 'LLLLLLLLLLLLL', 'LLwwwwwwwLLL.', '.LwwwwwwwLLLL', 'L.LLLLLLL.L..', '..L..L..L....']],
    ['버섯',
      // 갓 색: 아기 노랑 → 어린이 주황 → 어른 빨강
      ['.YYYYY.', 'YYWYYWY', 'YYYYYYY', '.CCCCC.', '.CECEC.', '.CCCCC.'],
      ['...OOOOO...', '..OOWOOOO..', '.OOOOOOWOO.', 'OWOOOOOOOOO', '..CCCCCCC..', '..CECCCEC..', '..CCCCCCC..', '...CC.CC...'],
      ['....RRRRR....', '..RRRWWRRRR..', '.RRRRWWRRWWR.', 'RWWRRRRRRWWRR', 'RWWRRRRRRRRRR', 'RRRRRRRRRRRRR', '...CCCCCCC...', '...CECCCEC...', '...CCCPCCC...', '...CCCCCCC...', '....CC.CC....']],
    ['로봇',
      ['...Y...', '.KKKKK.', '.KLKLK.', '.KKkKK.', 'KKKKKKK', '.K...K.'],
      ['.....Y.....', '.....K.....', '..KKKKKKK..', '..KLKKKLK..', '..KKKkKKK..', 'KKKKKKKKKKK', '..KKKKKKK..', '..KK...KK..'],
      ['......Y......', '......K......', '...KKKKKKK...', '...KLLKLLK...', '...KKkkkKK...', '...KKKKKKK...', '.KKKKKKKKKKK.', 'K.KKKRRRKKK.K', 'K.KKKKKKKKK.K', '..KKKKKKKKK..', '...KK...KK...', '..KKK...KKK..']],
  ];

  root.PET_ART = { PAL, EGG, SPECIES };
})(typeof window !== 'undefined' ? window : globalThis);
