"""Farmed / twin account scoring: the signals, the clusters, and the list.

Every signal has a positive and a negative case: the point is not to brand
accounts, it is to notice the shape of a farm without a human scrolling 300
profiles.

Run from the project root:

    python -m unittest tests.test_account_intel -v
"""

import os
import sys
import tempfile
import unittest
from datetime import timedelta
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'backend'))

_TMP = tempfile.TemporaryDirectory(prefix='sa_intel_')
os.environ.setdefault('SA_DB_PATH', str(Path(_TMP.name) / 'intel.db'))

import database  # noqa: E402
import app as app_module  # noqa: E402

TEST_API_KEY = 'test-key-not-a-secret'
API_HEADERS = {'X-API-Key': TEST_API_KEY}

TIKTOK = 'tiktok'
INSTAGRAM = 'instagram'


def account(username='salsaabl.f_', platform=TIKTOK, **fields):
    row = {
        'platform': platform,
        'username': username,
        'follower_count': 60000,
        'following_count': 300,
        'post_count': 120,
        'bio': f'kontak {username}',
        'display_name': username.title(),
        'region': 'ID',
        'is_verified': 0,
        'fetched_at': database._iso_now(),
    }
    row.update(fields)
    return row


def post(index, posted_at=None, likes=3000, comments=180, views=21000,
         shares=40, caption=None, ref=None):
    stamp = posted_at or f'2026-09-{index % 28 + 1:02d}T0{index % 9}:30:00Z'
    return {
        'post_ref': ref or f'ref{index}',
        'posted_at': stamp,
        'likes': likes,
        'comments': comments,
        'shares': shares,
        'views': views,
        'caption': caption if caption is not None else f'iklan kopi enak nomor {index}',
    }


def posts(count=8, **kwargs):
    return [post(index, **kwargs) for index in range(count)]


def history(months):
    return [{'month': month, 'follower_count': followers, 'post_count': uploads}
            for month, followers, uploads in months]


def score(row, rows=None, months=None, links=None):
    return database.analyse_account(row, rows or [], months or [], links or {})


def flag_keys(item):
    return [entry['key'] for entry in item['flags']]


def flag_detail(item, key):
    return next(entry['detail'] for entry in item['flags'] if entry['key'] == key)


class ReachSignalsTest(unittest.TestCase):
    def test_healthy_tiktok_account_is_not_flagged(self):
        item = score(account(), posts())
        self.assertEqual(item['flags'], [])
        self.assertEqual(item['score'], 0)
        self.assertEqual(item['level'], 'bersih')

    def test_bought_followers_show_as_flat_reach(self):
        row = account(follower_count=12000)
        item = score(row, posts(6, views=180, likes=1200, comments=300))
        self.assertIn('reach_rendah', flag_keys(item))
        self.assertIn('12.000', flag_detail(item, 'reach_rendah'))

    def test_reach_never_judges_before_enough_posts(self):
        item = score(account(follower_count=12000), posts(2, views=180, likes=20, comments=0))
        self.assertNotIn('reach_rendah', flag_keys(item))

    def test_reach_never_judges_accounts_below_the_band(self):
        item = score(account(follower_count=900), posts(8, views=40, likes=20, comments=1))
        self.assertNotIn('reach_rendah', flag_keys(item))

    def test_instagram_is_judged_on_likes_not_views(self):
        row = account(platform=INSTAGRAM, follower_count=40000)
        item = score(row, posts(6, likes=120, comments=10, views=None))
        self.assertIn('reach_rendah', flag_keys(item))
        self.assertEqual(item['metrics']['like_reach_pct'], 0.3)

    def test_lots_of_likes_without_comments_is_its_own_signal(self):
        item = score(account(follower_count=50000, post_count=10),
                     posts(6, likes=900, comments=0, views=40000))
        self.assertIn('komentar_minim', flag_keys(item))

    def test_active_comment_section_is_not_flagged(self):
        item = score(account(), posts(6, likes=900, comments=60, views=40000))
        self.assertNotIn('komentar_minim', flag_keys(item))


class UploadShapeTest(unittest.TestCase):
    def test_a_queue_of_uploads_on_one_device_is_caught(self):
        rows = [post(index, posted_at=f'2026-10-05T03:{index:02d}:00Z') for index in range(4)]
        item = score(account(), rows)
        self.assertIn('unggah_bertumpuk', flag_keys(item))
        self.assertEqual(item['metrics']['upload_burst'], 4)

    def test_a_post_a_day_does_not_look_like_a_queue(self):
        rows = [post(index, posted_at=f'2026-10-{index + 1:02d}T03:00:00Z') for index in range(6)]
        self.assertNotIn('unggah_bertumpuk', flag_keys(score(account(), rows)))

    def test_weekly_cadence_is_reported_not_guessed(self):
        rows = [post(index, posted_at=f'2026-10-{index * 7 + 1:02d}T03:00:00Z') for index in range(3)]
        self.assertEqual(score(account(), rows)['metrics']['posts_per_week'], 1.5)

    def test_following_more_than_followers_is_a_saller_account(self):
        item = score(account(follower_count=8000, following_count=12000))
        self.assertIn('akun_salur', flag_keys(item))
        self.assertEqual(item['score'], 1)


class MonthlySeriesTest(unittest.TestCase):
    def test_followers_stuck_while_uploads_keep_coming(self):
        row = account(follower_count=12000)
        months = history([('2026-08', 12000, 140), ('2026-09', 12050, 190)])
        item = score(row, posts(), months)
        self.assertIn('followers_datar', flag_keys(item))
        self.assertEqual(item['months_seen'], 2)

    def test_a_growing_account_is_left_alone(self):
        row = account(follower_count=12000)
        months = history([('2026-08', 9000, 140), ('2026-09', 12000, 190)])
        self.assertNotIn('followers_datar', flag_keys(score(row, posts(), months)))

    def test_flat_without_upload_growth_is_not_called_out(self):
        row = account(follower_count=12000)
        months = history([('2026-08', 12000, 140), ('2026-09', 12010, 141)])
        self.assertNotIn('followers_datar', flag_keys(score(row, posts(), months)))

    def test_one_month_of_history_never_claims_a_trend(self):
        row = account(follower_count=12000)
        item = score(row, posts(), history([('2026-09', 12000, 140)]))
        self.assertIsNone(item['follower_delta_pct'])
        self.assertNotIn('followers_datar', flag_keys(item))


class TwinLinkTest(unittest.TestCase):
    def link(self, rows, posts_by_account):
        return database.find_account_links(rows, posts_by_account)

    def test_the_same_whatsapp_number_in_two_bios_links_them(self):
        rows = [
            account('salsaabl.f_', bio='Endorse: WA 0812-3456-7890'),
            account('salsaabl.g_', bio='chat +62 812 3456 7890 (fast resp)'),
        ]
        links = self.link(rows, {})
        self.assertIn('kontak', links['tiktok:salsaabl.f_']['tiktok:salsaabl.g_'])

    def test_different_numbers_do_not_link(self):
        rows = [account('a', bio='WA 0812-1111-1111'), account('b', bio='WA 0812-2222-2222')]
        self.assertEqual(self.link(rows, {}), {})

    def test_a_year_in_the_bio_is_not_a_phone_number(self):
        rows = [account('a', bio='sejak 2024'), account('b', bio='since 2024')]
        self.assertEqual(self.link(rows, {}), {})

    def test_the_same_post_under_two_handles_is_hard_evidence(self):
        rows = [account('a'), account('b')]
        by_account = {
            'tiktok:a': [post(0), post(1)],
            'tiktok:b': [post(0, ref='ref0'), post(9, ref='ref9')],
        }
        links = self.link(rows, by_account)
        self.assertIn('konten', links['tiktok:a']['tiktok:b'])

    def test_the_same_video_id_on_another_platform_is_not_a_twin(self):
        rows = [account('a'), account('b', platform=INSTAGRAM)]
        by_account = {'tiktok:a': [post(0)], 'instagram:b': [post(0, ref='ref0')]}
        self.assertNotIn('konten', self.link(rows, by_account).get('tiktok:a', {}).get('instagram:b', set()))

    def test_repeated_captions_across_accounts_are_a_template(self):
        rows = [account('a'), account('b')]
        by_account = {
            'tiktok:a': [post(0, caption='order via wa ya kak, murah banget no 08111')],
            'tiktok:b': [post(0, caption='order via wa ya kak, murah banget no 08222')],
        }
        self.assertIn('template', self.link(rows, by_account)['tiktok:a']['tiktok:b'])

    def test_two_accounts_uploading_at_the_same_minutes_link_weakly(self):
        rows = [account('a'), account('b')]
        by_account = {
            'tiktok:a': [post(0, posted_at='2026-10-01T03:01:00Z', ref='x0'),
                         post(1, posted_at='2026-10-02T07:04:00Z', ref='x1')],
            'tiktok:b': [post(0, posted_at='2026-10-01T03:02:00Z', ref='y0'),
                         post(1, posted_at='2026-10-02T07:03:00Z', ref='y1')],
        }
        self.assertIn('serentak', self.link(rows, by_account)['tiktok:a']['tiktok:b'])

    def test_one_coincidental_minute_is_not_enough(self):
        rows = [account('a'), account('b')]
        by_account = {
            'tiktok:a': [post(0, posted_at='2026-10-01T03:01:00Z', ref='x0')],
            'tiktok:b': [post(0, posted_at='2026-10-01T03:02:00Z', ref='y0')],
        }
        self.assertEqual(self.link(rows, by_account), {})

    def test_cluster_groups_the_whole_farm_and_marks_it_strong(self):
        rows = [
            account('a', bio='WA 0812-0000-1111'),
            account('b', bio='WA 0812-0000-1111'),
            account('c', bio='WA 0812-0000-1111'),
        ]
        clusters = database.build_clusters(self.link(rows, {}))
        self.assertEqual(len(clusters), 1)
        self.assertEqual(clusters[0]['members'], ['tiktok:a', 'tiktok:b', 'tiktok:c'])
        self.assertTrue(clusters[0]['strong'])


class ScoringTest(unittest.TestCase):
    def test_level_follows_the_score(self):
        self.assertEqual(database.risk_level(0), 'bersih')
        self.assertEqual(database.risk_level(1), 'bersih')
        self.assertEqual(database.risk_level(2), 'amati')
        self.assertEqual(database.risk_level(6), 'pola_ternak')
        self.assertEqual(database.risk_level(10), 'pola_kembar')

    def test_two_independent_signals_only_mean_watch(self):
        row = account(follower_count=12000, following_count=15000)
        item = score(row, posts(6, views=180, likes=20, comments=0))
        self.assertIn('reach_rendah', flag_keys(item))
        self.assertIn('akun_salur', flag_keys(item))
        self.assertLess(item['score'], database.RISK_FLOORS['pola_ternak'])
        self.assertEqual(item['level'], 'amati')

    def test_shared_upload_evidence_escalates_even_a_weak_score(self):
        item = score(account(), [], [], {'tiktok:lain': {'template'}})
        self.assertEqual(item['level'], 'amati')
        linked = score(account(), [], [], {'tiktok:lain': {'kontak'}})
        self.assertEqual(linked['level'], 'pola_ternak')

    def test_flag_details_are_written_for_a_human_reading_indonesian(self):
        item = score(account(follower_count=12000), posts(6, views=180, likes=1200, comments=0))
        reach = flag_detail(item, 'reach_rendah')
        self.assertIn('(1,5%)', reach)
        self.assertNotIn('12,000', reach)
        instagram = score(account(platform=INSTAGRAM, follower_count=40000),
                          posts(6, views=None, likes=120, comments=10))
        self.assertIn('120 likes', flag_detail(instagram, 'reach_rendah'))

    def test_twin_evidence_names_handles_not_database_keys(self):
        item = score(account(), [], [], {'tiktok:dua': {'konten', 'serentak'},
                                         'tiktok:tiga': {'kontak'}})
        self.assertEqual(flag_detail(item, 'konten_kembar'),
                         'Ref posting yang sama juga muncul di @dua')
        self.assertIn('@dua', flag_detail(item, 'unggah_serentak'))
        self.assertIn('@tiga', flag_detail(item, 'kontak_bio_sama'))

    def test_verified_accounts_get_one_point_back(self):
        unverified = score(account(follower_count=12000), posts(6, views=180, likes=20, comments=0))
        verified = score(account(follower_count=12000, is_verified=1),
                         posts(6, views=180, likes=20, comments=0))
        self.assertEqual(verified['score'], unverified['score'] - 1)

    def test_band_is_the_observation_window_not_a_verdict(self):
        self.assertTrue(score(account(follower_count=7400))['in_ternak_band'])
        self.assertFalse(score(account(follower_count=25000))['in_ternak_band'])


class IntelCase(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(prefix='sa_intel_case_')
        self.saved_path = database.DB_PATH
        database.DB_PATH = str(Path(self.tmp.name) / 'intel.db')
        database.init_db()
        self.addCleanup(self._restore)

    def _restore(self):
        database.DB_PATH = self.saved_path
        self.tmp.cleanup()

    def _next_day(self):
        self._day = getattr(self, '_day', 0) + 1
        return self._day

    def harvest(self, username, platform=TIKTOK, followers=60000, following=300,
                uploads=120, bio=None, posts=None, is_verified=False):
        """Store one profile visit.

        Handles, refs and captions shift per account, and each account gets its
        own upload day, so two accounts only end up linked when the test puts
        the evidence there on purpose.
        """
        day = self._next_day()
        rows = posts if posts is not None else [
            post(index, ref=f'{username}{index}', caption=f'iklan {username} kopi nomor {index}')
            for index in range(6)
        ]
        payload_posts = []
        for index, row in enumerate(rows):
            payload_posts.append({
                'id': row['post_ref'],
                'url': f'https://www.tiktok.com/@{username}/video/{row["post_ref"]}',
                'postedAt': row.get('posted_at') or f'2026-09-{day:02d}T{6 + index:02d}:00:00Z',
                'likes': row.get('likes'),
                'comments': row.get('comments'),
                'shares': row.get('shares'),
                'views': row.get('views'),
                'caption': row.get('caption'),
                'isVideo': True,
            })
        return database.record_account_profile({
            'platform': platform,
            'username': username,
            'followerCount': followers,
            'followingCount': following,
            'postCount': uploads,
            'bio': bio if bio is not None else f'kontak {username}',
            'isVerified': is_verified,
            'posts': payload_posts,
        })

    def farm_posts(self, username):
        day = self._next_day()
        return [
            post(index, ref=f'{username}{index}', views=90, likes=300, comments=0,
                 caption=f'iklan {username} kopi nomor {index}',
                 posted_at=f'2026-10-{day:02d}T03:0{index}:00Z')
            for index in range(5)
        ]

    def stamp_old(self, username, days=30, platform=TIKTOK):
        stale = (database._utc_now() - timedelta(days=days)).isoformat(
            timespec='seconds').replace('+00:00', 'Z')
        conn = database.get_db_connection()
        try:
            conn.execute(
                'UPDATE accounts SET fetched_at = ? WHERE platform = ? AND username = ?',
                (stale, platform, username))
            conn.commit()
        finally:
            conn.close()


class IntelListTest(IntelCase):
    def test_list_carries_risk_and_refresh_state_per_account(self):
        self.harvest('salsaabl.f_')
        self.harvest('ternak.sekali', followers=9000, following=9500,
                     posts=self.farm_posts('ternak.sekali'))

        result = database.get_account_intel()
        by_name = {item['username']: item for item in result['items']}
        self.assertEqual(set(by_name), {'salsaabl.f_', 'ternak.sekali'})
        self.assertEqual(by_name['salsaabl.f_']['flags'], [])
        self.assertEqual(by_name['salsaabl.f_']['level'], 'bersih')
        self.assertGreaterEqual(by_name['ternak.sekali']['score'],
                                database.RISK_FLOORS['pola_ternak'])
        self.assertFalse(by_name['salsaabl.f_']['needs_refresh'])
        self.assertEqual(result['summary']['accounts'], 2)
        self.assertEqual(result['clusters'], [], 'distinct accounts must not invent a farm')

    def test_band_and_level_filters_narrow_the_list(self):
        self.harvest('kecil', followers=800)
        self.harvest('ternak', followers=9000, posts=self.farm_posts('ternak'))
        self.harvest('besar', followers=250000)

        self.assertEqual([item['username'] for item in
                          database.get_account_intel(band='ternak')['items']], ['ternak'])
        self.assertEqual(database.get_account_intel(band='kecil')['total'], 1)
        self.assertEqual(database.get_account_intel(band='besar')['total'], 1)
        self.assertEqual([item['username'] for item in
                          database.get_account_intel(level='pola_ternak')['items']], ['ternak'])
        self.assertEqual(database.get_account_intel(level='bersih')['total'], 2)

    def test_platform_and_query_filters(self):
        self.harvest('salsaabl.f_', bio='Endorse: WA 0812-3456-7890')
        self.harvest('alice', platform=INSTAGRAM)
        self.assertEqual(database.get_account_intel(platform=INSTAGRAM)['total'], 1)
        self.assertEqual(database.get_account_intel(query='salsa')['total'], 1)
        self.assertEqual(database.get_account_intel(query='0812')['total'], 1)
        self.assertEqual(database.get_account_intel(query='tidakada')['total'], 0)

    def test_sorting_puts_the_worst_first(self):
        self.harvest('bersih')
        self.harvest('ternak', followers=9000, posts=self.farm_posts('ternak'))
        risk = [item['username'] for item in database.get_account_intel(sort='risk')['items']]
        self.assertEqual(risk, ['ternak', 'bersih'])

        names = [item['username'] for item in
                 database.get_account_intel(sort='username', direction='asc')['items']]
        self.assertEqual(names, sorted(names))

    def test_old_harvest_is_marked_for_refresh(self):
        self.harvest('lama')
        self.stamp_old('lama', days=30)
        item = database.get_account_intel()['items'][0]
        self.assertTrue(item['needs_refresh'])
        self.assertGreater(item['data_age_minutes'], 20000)
        self.assertEqual(database.get_account_intel(sort='age')['summary']['needs_refresh'], 1)

    def test_appearance_in_audits_joins_through_a_dirty_username(self):
        self.harvest('salsaabl.f_')
        database.create_audit_with_tasks([
            {'url': 'https://www.tiktok.com/@salsaabl.f_/video/111',
             'platform': TIKTOK, 'username': 'Salsaabl.f_ (Tiktok)', 'tema': 'kopi'},
            {'url': 'https://www.tiktok.com/@salsaabl.f_/video/222',
             'platform': TIKTOK, 'username': '@salsaabl.f_', 'tema': 'kopi'},
        ], name='Oktober')
        item = database.get_account_intel()['items'][0]
        self.assertEqual(item['targets_seen'], 2)
        self.assertEqual(item['audits_seen'], 1)

    def test_pagination_slices_after_filtering(self):
        for index in range(5):
            self.harvest(f'akun{index}')
        first = database.get_account_intel(limit=2, offset=0, sort='username', direction='asc')
        second = database.get_account_intel(limit=2, offset=2, sort='username', direction='asc')
        self.assertEqual(first['total'], 5)
        self.assertEqual([item['username'] for item in first['items']], ['akun0', 'akun1'])
        self.assertEqual([item['username'] for item in second['items']], ['akun2', 'akun3'])

    def test_summary_counts_the_whole_corpus_not_just_the_page(self):
        self.harvest('salsaabl.f_')
        self.harvest('ternak', followers=9000, posts=self.farm_posts('ternak'))
        self.harvest('lama', followers=7000)
        self.stamp_old('lama')
        summary = database.get_account_intel(limit=1)['summary']
        self.assertEqual(summary['accounts'], 3)
        self.assertEqual(summary['shown'], 3)
        self.assertEqual(summary['in_band'], 2)
        self.assertEqual(summary['needs_refresh'], 1)
        self.assertEqual(summary['visit_budget'], database.VISIT_BUDGET_PER_CYCLE)

    def test_detail_adds_posts_series_and_siblings(self):
        self.harvest('satu', bio='WA 0812-3456-7890')
        self.harvest('dua', bio='+62 812 3456 7890')
        detail = database.get_account_detail('satu', TIKTOK)
        self.assertEqual(len(detail['posts']), 6)
        self.assertEqual(len(detail['history']), 1)
        self.assertEqual(detail['siblings'][0]['username'], 'dua')
        self.assertIn('kontak', detail['siblings'][0]['reasons'])
        self.assertEqual(detail['clusters'][0]['size'], 2)
        self.assertIsNone(database.get_account_detail('tidakada'))
        self.assertEqual(database.get_account_detail('@satu (Tiktok)')['key'], 'tiktok:satu')


class AccountApiTest(IntelCase):
    def setUp(self):
        super().setUp()
        app_module.API_KEY = TEST_API_KEY
        app_module.app.config.update(TESTING=True)
        self.client = app_module.app.test_client()

    def test_list_needs_a_key(self):
        self.assertEqual(self.client.get('/api/accounts').status_code, 401)

    def test_list_reports_scores_and_the_thresholds_behind_them(self):
        self.harvest('salsaabl.f_')
        self.harvest('ternak', followers=9000, posts=self.farm_posts('ternak'))
        body = self.client.get('/api/accounts?band=ternak', headers=API_HEADERS).get_json()
        self.assertEqual(body['total'], 1)
        self.assertEqual(body['items'][0]['username'], 'ternak')
        self.assertTrue(body['items'][0]['flags'])
        self.assertEqual(body['summary']['accounts'], 2)
        self.assertEqual(body['thresholds']['band'], [5000, 20000])
        self.assertIn('view_reach_floor', body['thresholds'])

    def test_detail_returns_posts_series_and_siblings(self):
        self.harvest('satu', bio='WA 0812-3456-7890')
        self.harvest('dua', bio='+62 812 3456 7890')
        response = self.client.get('/api/accounts/tiktok/@satu', headers=API_HEADERS)
        self.assertEqual(response.status_code, 200)
        account = response.get_json()['account']
        self.assertEqual(account['username'], 'satu')
        self.assertEqual(len(account['posts']), 6)
        self.assertEqual(len(account['history']), 1)
        self.assertEqual(account['siblings'][0]['username'], 'dua')

    def test_unknown_account_is_a_clear_answer_not_a_crash(self):
        self.assertEqual(self.client.get('/api/accounts/tiktok/tiada',
                                         headers=API_HEADERS).status_code, 404)
        self.assertEqual(self.client.get('/api/accounts/tiktok/tiada').status_code, 401)


if __name__ == '__main__':
    unittest.main(verbosity=2)
