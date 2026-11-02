"""Isolated API smoke test. Never touches the live database.

Run from the project root:

    python -m unittest tests.test_api_smoke -v
"""

import csv
import io
import os
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'backend'))

_TMP = tempfile.TemporaryDirectory(prefix='sa_api_test_')
_TMP_ROOT = Path(_TMP.name)
os.environ['SA_DB_PATH'] = str(_TMP_ROOT / 'test.db')

import app as app_module  # noqa: E402
import database  # noqa: E402

TEST_API_KEY = 'test-key-not-a-secret'
API_HEADERS = {'X-API-Key': TEST_API_KEY}


def _csv_file(rows):
    buffer = io.StringIO()
    writer = csv.writer(buffer)
    writer.writerow(['Link', 'Username', 'Tema'])
    writer.writerows(rows)
    return io.BytesIO(buffer.getvalue().encode('utf-8'))


class ApiSmokeTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        app_module.API_KEY = TEST_API_KEY
        app_module.app.config.update(TESTING=True)
        app_module.UPLOAD_FOLDER = str(_TMP_ROOT / 'uploads')
        app_module.EXPORT_FOLDER = str(_TMP_ROOT / 'uploads' / 'exports')
        os.makedirs(app_module.EXPORT_FOLDER, exist_ok=True)
        database.init_db()
        cls.client = app_module.app.test_client()
        cls.audit_id = None
        cls.run_id = None
        cls.task_ids = []

    def upload(self, rows, **fields):
        data = {'file': (_csv_file(rows), 'targets.csv')}
        data.update(fields)
        return self.client.post(
            '/api/upload',
            data=data,
            headers=API_HEADERS,
            content_type='multipart/form-data',
        )

    def test_01_health_and_auth(self):
        health = self.client.get('/api/health')
        self.assertEqual(health.status_code, 200)
        self.assertEqual(health.get_json()['status'], 'healthy')
        self.assertEqual(health.get_json()['version'], '3.5.0')

        self.assertEqual(self.client.get('/api/stats').status_code, 401)
        self.assertEqual(self.client.get('/api/auth/check').status_code, 401)
        self.assertEqual(
            self.client.get('/api/auth/check', headers=API_HEADERS).status_code,
            200,
        )

    def test_02_upload_then_append(self):
        first = self.upload([
            ['https://www.instagram.com/p/AAA111/', 'alice', 'Kampanye A'],
            ['https://www.tiktok.com/@bob/video/1234567890', '@bob', 'Kampanye B'],
            ['https://example.com/not-social', 'nope', 'Invalid'],
            ['', '', ''],
        ], audit_name='Smoke Audit', repeat_days='3')
        self.assertEqual(first.status_code, 200, first.get_data(as_text=True))
        payload = first.get_json()
        self.assertTrue(payload['success'])
        self.assertEqual(payload['inserted'], 2)
        self.assertEqual(payload['invalid_urls'], 1)
        self.assertFalse(payload['append'])
        self.assertEqual(payload['repeat_days'], 3)
        self.assertTrue(payload['audit_id'])
        type(self).audit_id = payload['audit_id']
        type(self).run_id = payload['run_id']

        appended = self.upload([
            ['https://www.instagram.com/p/AAA111/', 'alice', 'Duplikat'],
            ['https://www.instagram.com/p/CCC222/', 'carol', 'Kampanye C'],
        ], audit_id=str(self.audit_id))
        self.assertEqual(appended.status_code, 200, appended.get_data(as_text=True))
        appended_payload = appended.get_json()
        self.assertTrue(appended_payload['append'])
        self.assertEqual(appended_payload['inserted'], 1)
        self.assertEqual(appended_payload['duplicates'], 1)

        targets = self.client.get(
            f'/api/targets?audit_id={self.audit_id}&limit=50',
            headers=API_HEADERS,
        ).get_json()
        self.assertEqual(targets['total'], 3)
        self.assertEqual(len(targets['items']), 3)

    def test_03_results_stats_and_sorting(self):
        self.assertIsNotNone(self.audit_id)

        tasks = []
        for _ in range(3):
            response = self.client.get('/api/task/next', headers=API_HEADERS)
            self.assertEqual(response.status_code, 200)
            task = response.get_json().get('task')
            self.assertIsNotNone(task)
            tasks.append(task)

        results = [
            {
                'status': 'OK', 'platform': 'instagram', 'username': 'alice',
                'likes': 100, 'comments': 10, 'views': 0, 'shares': 0,
                'followerCount': 1000,
            },
            {
                'status': 'FAILED', 'platform': 'tiktok', 'username': 'bob',
                'error': 'Postingan private', 'errorCode': 'PERMANENT',
            },
            {
                'status': 'PARTIAL', 'platform': 'instagram', 'username': 'carol',
                'likes': 5, 'comments': 1, 'views': 0, 'shares': 0,
                'followerCount': 500,
            },
        ]
        for task, result in zip(tasks, results):
            response = self.client.post(
                '/api/task/result',
                json={'taskId': task['id'], 'result': result},
                headers=API_HEADERS,
            )
            self.assertEqual(response.status_code, 200)
            self.assertTrue(response.get_json()['success'])

        stats = self.client.get('/api/stats', headers=API_HEADERS).get_json()
        self.assertEqual(stats['OK'], 1)
        self.assertEqual(stats['FAILED'], 1)
        self.assertEqual(stats['PARTIAL'], 1)
        self.assertEqual(stats['TARGETS'], 3)
        self.assertIsNotNone(stats['WORKER_LAST_SEEN'])

        done = self.client.get(
            f'/api/targets?audit_id={self.audit_id}&status=done',
            headers=API_HEADERS,
        ).get_json()
        self.assertEqual(done['total'], 2)

        failed = self.client.get(
            f'/api/targets?audit_id={self.audit_id}&status=failed',
            headers=API_HEADERS,
        ).get_json()
        self.assertEqual(failed['total'], 1)
        self.assertEqual(failed['items'][0]['username'], 'bob')

        searched = self.client.get(
            f'/api/targets?audit_id={self.audit_id}&q=alice',
            headers=API_HEADERS,
        ).get_json()
        self.assertEqual(searched['total'], 1)

        by_followers = self.client.get(
            f'/api/targets?audit_id={self.audit_id}&sort=followers&dir=desc',
            headers=API_HEADERS,
        ).get_json()['items']
        values = [row['follower_count'] for row in by_followers if row['follower_count'] is not None]
        self.assertEqual(values, sorted(values, reverse=True))
        self.assertEqual(values[0], 1000)

        ascending = self.client.get(
            f'/api/targets?audit_id={self.audit_id}&sort=username&dir=asc',
            headers=API_HEADERS,
        ).get_json()['items']
        names = [row['username'] for row in ascending]
        self.assertEqual(names, sorted(names, key=str.lower))

        latest = self.client.get(
            f'/api/latest?audit_id={self.audit_id}&limit=10',
            headers=API_HEADERS,
        ).get_json()
        self.assertEqual(len(latest), 3)
        self.assertTrue(all('audit_name' in row for row in latest))

    def test_04_retry_failed_and_export_filter(self):
        retry = self.client.post(
            f'/api/audits/{self.audit_id}/retry-failed',
            headers=API_HEADERS,
        )
        self.assertEqual(retry.status_code, 200)
        retry_payload = retry.get_json()
        self.assertTrue(retry_payload['success'])
        self.assertEqual(retry_payload['created'], 1)

        next_task = self.client.get('/api/task/next', headers=API_HEADERS).get_json()
        self.assertTrue(next_task['hasTask'])
        self.assertEqual(next_task['task']['username'], 'bob')

        response = self.client.post(
            '/api/task/result',
            json={
                'taskId': next_task['task']['id'],
                'result': {
                    'status': 'OK', 'platform': 'tiktok', 'username': 'bob',
                    'likes': 120, 'comments': 15, 'views': 3000, 'shares': 4,
                    'followerCount': 2000,
                },
            },
            headers=API_HEADERS,
        )
        self.assertEqual(response.status_code, 200)

        latest = self.client.get(
            f'/api/latest?audit_id={self.audit_id}&limit=10',
            headers=API_HEADERS,
        ).get_json()
        bob = next(row for row in latest if row['username'] == 'bob')
        self.assertEqual(bob['likes'], 120)

        export = self.client.get(
            f'/api/export?audit_id={self.audit_id}&status=OK',
            headers=API_HEADERS,
        )
        self.assertEqual(export.status_code, 200)
        self.assertTrue(export.data.startswith(b'PK'))
        export.close()

        failed_export = self.client.get(
            f'/api/export?audit_id={self.audit_id}&status=FAILED',
            headers=API_HEADERS,
        )
        self.assertEqual(failed_export.status_code, 200)
        self.assertTrue(failed_export.data.startswith(b'PK'))
        failed_export.close()

    def test_05_append_rejects_empty_and_missing_audit(self):
        empty = self.upload(
            [
                ['https://example.com/not-social', 'nope', 'Invalid'],
                ['', '', ''],
            ],
            audit_id=str(self.audit_id),
        )
        self.assertEqual(empty.status_code, 400, empty.get_data(as_text=True))
        self.assertEqual(
            empty.get_json()['error'],
            'Tidak ada target valid untuk ditambahkan.',
        )

        missing = self.upload(
            [['https://www.instagram.com/p/DDD444/', 'dave', 'Kampanye D']],
            audit_id='999999',
        )
        self.assertEqual(missing.status_code, 404, missing.get_data(as_text=True))
        self.assertEqual(
            missing.get_json()['error'],
            'Audit yang dipilih tidak ditemukan.',
        )

    def test_06_upload_ceiling_is_a_single_number(self):
        self.assertEqual(
            app_module.app.config['MAX_CONTENT_LENGTH'],
            app_module.MAX_UPLOAD_BYTES,
        )

        oversized = b'Link,Username,Tema\n' + b'x' * (app_module.MAX_UPLOAD_BYTES + 1)
        response = self.client.post(
            '/api/upload',
            data={'file': (io.BytesIO(oversized), 'oversize.csv')},
            headers=API_HEADERS,
            content_type='multipart/form-data',
        )
        self.assertEqual(response.status_code, 413)
        expected_mb = app_module.MAX_UPLOAD_BYTES // (1024 * 1024)
        self.assertEqual(
            response.get_json()['error'],
            f'File terlalu besar (max {expected_mb}MB).',
        )


def tearDownModule():
    _TMP.cleanup()


if __name__ == '__main__':
    unittest.main(verbosity=2)
