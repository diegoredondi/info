const express = require('express');
const cors = require('cors');
const mysql = require('mysql');
const jwt = require('jsonwebtoken');
const port = 16016;
const app = express();
app.use(cors());
app.use(express.json());

require('dotenv').config()
const db = mysql.createConnection({
    host: process.env.host,
    user: process.env.user,
    password: process.env.password,
    database: process.env.database
});

db.connect((err) => {
    if (err) {
        throw err;
    }
    console.log('Connesso al database');
});

function verifica(req, res, next) {
    const token = req.header('auth-token');
    if (!token) return res.status(401).send('Accesso negato');

    try {
        if (jwt.verify(token, process.env.secret))
            next();
        else
            return res.status(401).send('Token non valido');
    } catch (err) {
        return res.status(401).send('Token non valido');
    }
}




// ######## Utente ########

app.post('/registrati', (req, res) => {
    const { nickname, password, nome, cognome } = req.body;
    db.query('INSERT INTO chat_utente (nickname, password, nome, cognome) VALUES (?, ?, ?, ?)', [nickname, password, nome, cognome], (err, result) => {
        if (err)
            return res.send(err);

        res.send({ token: jwt.sign({ nickname: nickname }, process.env.secret, { expiresIn: '1h' }) });
    });
});

app.post('/login', (req, res) => {
    const { nickname, password } = req.body;
    db.query('SELECT * FROM chat_utente WHERE nickname = ? AND password = ?', [nickname, password], (err, result) => {
        if (err)
            return res.send(err);

        if (result.length > 0) {
            res.send({ token: jwt.sign({ nickname: nickname }, process.env.secret, { expiresIn: '1h' }) });
        } else {
            res.send('Username o password errati');
        }
    });
});




// ######## Messaggi ########

app.get('/messaggi', verifica, (req, res) => {
    const token = req.header('auth-token');
    const { nickname } = jwt.decode(token);

    db.query('SELECT m.* FROM chat_messaggio m INNER JOIN (SELECT LEAST(id_mittente, destinatario) AS utente1, GREATEST(id_mittente, destinatario) AS utente2, MAX(time_invio) AS max_time FROM chat_messaggio WHERE id_mittente = ? OR destinatario = ? GROUP BY utente1, utente2) AS sub ON LEAST(m.id_mittente, m.destinatario) = sub.utente1 AND GREATEST(m.id_mittente, m.destinatario) = sub.utente2 AND m.time_invio = sub.max_time ORDER BY m.time_invio DESC;', [nickname, nickname], (err, result) => {
        if (err)
            return res.send(err);

        res.json(result);
    });
});

app.get('/messaggi/:destinatario', verifica, (req, res) => {
    const token = req.header('auth-token');
    const { nickname } = jwt.decode(token);
    const { destinatario } = req.params;

    db.query('SELECT * FROM chat_messaggio WHERE (id_mittente = ? AND destinatario = ?) OR (id_mittente = ? AND destinatario = ?) ORDER BY time_invio', [nickname, destinatario, destinatario, nickname], (err, result) => {
        if (err)
            return res.send(err);

        res.json(result);
    });
});

app.get('/messaggi/gruppi/:gruppo', verifica, (req, res) => {
    const token = req.header('auth-token');
    const { nickname } = jwt.decode(token);
    const { gruppo } = req.params;

    db.query('SELECT * FROM chat_componenti WHERE id_gruppo = ? AND id_utente = ?', [gruppo, nickname], (err, result) => {
        if (err)
            return res.send(err);

        var resObj = { 'ruolo': result[0].ruolo };

        db.query('SELECT m.* FROM chat_messaggio m JOIN chat_destinatari_gruppi dg ON m.ID = dg.id_messaggio WHERE dg.id_gruppo = ?', [gruppo], (err, result) => {
            if (err) {
                console.log(err);
                return res.send(err);
            }

            resObj['messaggi'] = result;

            console.log(resObj);

            res.json(resObj);
        });
    });

});

app.post('/messaggi', verifica, (req, res) => {
    const token = req.header('auth-token');
    const { nickname } = jwt.decode(token);
    const { destinatario, messaggio } = req.body;

    if (nickname === destinatario)
        return res.status(400).send('Non puoi inviarti un messaggio');

    if (messaggio && destinatario) {
        db.query('INSERT INTO chat_messaggio (testo, id_mittente, destinatario) VALUES (?,?,?)', [messaggio, nickname, destinatario], (err, result) => {
            if (err)
                return res.status(400).send(err);

            res.status(200).send('Messaggio inviato');
        });
    } else {
        res.status(400).send('Messaggio non valido');
    }
});

app.post('/messaggi/gruppi', verifica, (req, res) => {
    const token = req.header('auth-token');
    const { nickname } = jwt.decode(token);
    const { gruppo, messaggio } = req.body;

    if (messaggio && gruppo) {
        db.query('INSERT INTO chat_messaggio (testo, id_mittente) VALUES (?,?)', [messaggio, nickname], (err, result) => {
            if (err) {
                console.log(err);
                return res.status(400).send(err);
            }

            db.query('INSERT INTO chat_destinatari_gruppi (id_messaggio, id_gruppo) VALUES (?,?)', [result.insertId, gruppo], (err, result) => {
                if (err) {
                    console.log(err);
                    return res.status(400).send(err);
                }
                res.status(200).send('Messaggio inviato');
            });
        });
    } else {
        res.status(400).send('Messaggio non valido');
    }
});


// ######## Gruppi ########

app.get('/gruppi', verifica, (req, res) => {
    const token = req.header('auth-token');
    const { nickname } = jwt.decode(token);
    db.query('SELECT c.*, g.ID AS id_gruppo, g.nome AS nome_gruppo FROM chat_componenti c INNER JOIN chat_gruppo g ON c.id_gruppo = g.ID WHERE c.id_utente = ?', [nickname], (err, result) => {
        if (err) return res.send(err);
        res.json(result);
    });
});

app.post('/gruppi', verifica, (req, res) => {
    const { nome } = req.body;
    db.query('INSERT INTO chat_gruppo (nome) VALUES (?)', [nome], (err, result) => {
        if (err)
            return res.send(err);

        // Aggiungere l'utente che ha creato il gruppo
        const token = req.header('auth-token');
        const { nickname } = jwt.decode(token);
        db.query('INSERT INTO chat_componenti (id_gruppo, id_utente, ruolo) VALUES (?, ?, ?)', [result.insertId, nickname, 'admin'], (err, result) => {
            if (err)
                return res.send(err);
        });
        return res.status(200).send('Gruppo creato');
    });
});

app.post('/componenti', verifica, (req, res) => {
    const { gruppo, utente, ruolo } = req.body;
    db.query('INSERT INTO chat_componenti (id_gruppo, id_utente, ruolo) VALUES (?, ?, ?)', [gruppo, utente, ruolo], (err, result) => {
        if (err) {
            console.log(err);
            return res.send(err);
        }

        res.send('Utente aggiunto al gruppo');
    });
});


app.listen(port, () => {
    console.log(`Server in ascolto su porta: ${port}`);
});